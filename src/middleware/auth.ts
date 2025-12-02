import { createHmac, timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';

/**
 * Minimum API secret length for security
 */
const MIN_API_SECRET_LENGTH = 32;

/**
 * Maximum age of a request timestamp in seconds (60 seconds)
 */
const MAX_TIMESTAMP_AGE = 60;

/**
 * Computes HMAC-SHA256 signature for the given message
 * @param message The message to sign
 * @param secret The secret key
 * @returns The HMAC signature in base64url format
 */
function computeHmac(message: string, secret: string): string {
    return createHmac('sha256', secret).update(message).digest('base64url');
}

/**
 * Validates an HMAC signature using constant-time comparison
 * @param signature The signature to validate
 * @param expectedSignature The expected signature
 * @returns true if signatures match, false otherwise
 */
function validateSignature(signature: string, expectedSignature: string): boolean {
    if (!signature || !expectedSignature) {
        return false;
    }

    // Convert to buffers for constant-time comparison
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    // Lengths must match for timingSafeEqual
    if (signatureBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
}

/**
 * Extracts the Bearer token from the Authorization header
 * Case-insensitive matching of "Bearer" scheme with support for multiple spaces
 * @param authHeader The Authorization header value
 * @returns The token if valid format, undefined otherwise
 */
function extractBearerToken(authHeader: string | undefined): string | undefined {
    if (!authHeader) {
        return undefined;
    }

    // Match "Bearer" (case-insensitive) followed by one or more spaces and the token
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : undefined;
}

/**
 * Validates a timestamp to ensure it's not too old
 * @param timestamp Unix timestamp in seconds
 * @returns true if timestamp is valid and recent, false otherwise
 */
function isValidTimestamp(timestamp: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    const age = Math.abs(now - timestamp);

    // Reject if timestamp is more than MAX_TIMESTAMP_AGE seconds old
    // Also reject if timestamp is in the future (with small tolerance)
    return age <= MAX_TIMESTAMP_AGE && timestamp <= now + 60;
}

/**
 * Builds the canonical message for HMAC signature
 * Format: method=POST;path=/heartbeat;ts=1733144872;nonce=89af77e23a;body=...
 * @param method HTTP method (GET, POST, etc.)
 * @param path Request path
 * @param timestamp Unix timestamp
 * @param nonce Random nonce
 * @param body Request body as JSON string (empty string for GET requests)
 * @returns The canonical message string
 */
function buildCanonicalMessage(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string
): string {
    return `method=${method.toUpperCase()};path=${path};ts=${timestamp};nonce=${nonce};body=${body}`;
}

/**
 * Authentication middleware using HMAC-based authentication
 *
 * Authenticates requests using HMAC-SHA256 signatures with the following headers:
 * - Authorization: Bearer <hmac_signature>
 * - Signature-Timestamp: <unix_timestamp>
 * - Signature-Nonce: <random_string>
 *
 * The HMAC signature is computed over: method=METHOD;path=PATH;ts=TIMESTAMP;nonce=NONCE;body=BODY
 */
export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    const apiSecret = process.env.API_SECRET?.trim();

    // Validate API secret configuration
    if (!apiSecret || apiSecret.length === 0) {
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: 'API secret not configured',
        });
        return;
    }

    // Validate API secret meets minimum security requirements
    if (apiSecret.length < MIN_API_SECRET_LENGTH) {
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: `API secret must be at least ${MIN_API_SECRET_LENGTH} characters`,
        });
        return;
    }

    // Extract required headers
    const authHeader = request.headers.authorization;
    const timestampHeader = request.headers['signature-timestamp'] as string | undefined;
    const nonceHeader = request.headers['signature-nonce'] as string | undefined;

    // Extract signature from Authorization header
    const signature = extractBearerToken(authHeader);

    // Validate all required components are present
    if (!signature || !timestampHeader || !nonceHeader) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Parse and validate timestamp
    const timestamp = Number.parseInt(timestampHeader, 10);
    if (Number.isNaN(timestamp) || !isValidTimestamp(timestamp)) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Validate nonce (must be non-empty)
    if (nonceHeader.trim().length === 0) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Get request body as JSON string (empty string for GET requests or no body)
    const bodyString = request.body ? JSON.stringify(request.body) : '';

    // Build canonical message
    const canonicalMessage = buildCanonicalMessage(
        request.method,
        request.url,
        timestampHeader,
        nonceHeader,
        bodyString
    );

    // Compute expected HMAC signature
    const expectedSignature = computeHmac(canonicalMessage, apiSecret);

    // Validate signature using constant-time comparison
    if (!validateSignature(signature, expectedSignature)) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Authentication successful
    done();
}
