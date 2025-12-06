import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';
import { API_PREFIX } from '../constants/api.js';

/**
 * Minimum API secret length for security
 */
const MIN_API_SECRET_LENGTH = 32;

/**
 * Maximum age of a request timestamp in seconds (60 seconds)
 */
const MAX_TIMESTAMP_AGE = 60;

/**
 * Maximum allowed future timestamp skew in seconds (10 seconds for clock drift)
 */
const MAX_FUTURE_SKEW = 10;

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
    // Also reject if timestamp is too far in the future (allow small tolerance for clock skew)
    return age <= MAX_TIMESTAMP_AGE && timestamp <= now + MAX_FUTURE_SKEW;
}

/**
 * Normalizes a header value to a single string
 * Rejects headers with multiple values to avoid ambiguity
 * @param header The header value (string | string[] | undefined)
 * @returns The header value as a string, or undefined if invalid
 */
function normalizeHeader(header: string | string[] | undefined): string | undefined {
    if (Array.isArray(header)) {
        return header.length === 1 ? header[0] : undefined;
    }

    return header;
}

/**
 * Builds the canonical message for HMAC signature
 * Format: method=POST;path=/heartbeat;ts=1733144872;nonce=89af77e23a;body_sha256=...
 * @param method HTTP method (GET, POST, etc.)
 * @param path Request path
 * @param timestamp Unix timestamp
 * @param nonce Random nonce
 * @param body Request body as string (empty string for GET requests)
 * @returns The canonical message string
 */
function buildCanonicalMessage(
    method: string,
    path: string,
    timestamp: string,
    nonce: string,
    body: string
): string {
    // Hash the body with SHA256 for inclusion in canonical message
    const bodyHash = createHash('sha256').update(body).digest('base64url');
    return `method=${method.toUpperCase()};path=${path};ts=${timestamp};nonce=${nonce};body_sha256=${bodyHash}`;
}

/**
 * Authentication middleware using HMAC-based authentication
 *
 * Authenticates requests using HMAC-SHA256 signatures with the following headers:
 * - Authorization: Bearer <hmac_signature>
 * - Signature-Timestamp: <unix_timestamp>
 * - Signature-Nonce: <random_string>
 *
 * The HMAC signature is computed over: method=METHOD;path=PATH;ts=TIMESTAMP;nonce=NONCE;body_sha256=HASH
 */
export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    const apiSecret = process.env.API_SECRET?.trim();

    request.log.debug('[AUTH] Starting authentication');

    // Validate API secret configuration
    if (!apiSecret || apiSecret.length === 0) {
        request.log.error('[AUTH] API secret not configured');
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: 'API secret not configured',
        });
        return;
    }

    // Validate API secret meets minimum security requirements
    if (apiSecret.length < MIN_API_SECRET_LENGTH) {
        request.log.error('[AUTH] API secret too short', {
            length: apiSecret.length,
            required: MIN_API_SECRET_LENGTH,
        });
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: `API secret must be at least ${MIN_API_SECRET_LENGTH} characters`,
        });
        return;
    }

    // Extract required headers
    const authHeader = normalizeHeader(
        request.headers.authorization as string | string[] | undefined
    );
    const timestampHeader = normalizeHeader(
        request.headers['signature-timestamp'] as string | string[] | undefined
    );
    const nonceHeader = normalizeHeader(
        request.headers['signature-nonce'] as string | string[] | undefined
    );

    request.log.debug('[AUTH] Headers received', {
        hasAuthHeader: !!authHeader,
        hasTimestamp: !!timestampHeader,
        hasNonce: !!nonceHeader,
        authHeaderType: typeof authHeader,
        timestampHeaderType: typeof timestampHeader,
        nonceHeaderType: typeof nonceHeader,
    });

    // Validate header types (reject if arrays - multiple values sent)
    if (
        typeof authHeader !== 'string' ||
        typeof timestampHeader !== 'string' ||
        typeof nonceHeader !== 'string'
    ) {
        request.log.warn('[AUTH] Invalid header types');
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Extract signature from Authorization header
    const signature = extractBearerToken(authHeader);

    // Validate all required components are present
    if (!signature || !timestampHeader || !nonceHeader) {
        request.log.warn('[AUTH] Missing required auth components', {
            hasSignature: !!signature,
            hasTimestamp: !!timestampHeader,
            hasNonce: !!nonceHeader,
        });
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Parse and validate timestamp
    const timestamp = Number.parseInt(timestampHeader, 10);
    const now = Math.floor(Date.now() / 1000);
    const timestampAge = Math.abs(now - timestamp);

    request.log.debug('[AUTH] Timestamp validation', {
        timestamp,
        now,
        age: timestampAge,
        maxAge: MAX_TIMESTAMP_AGE,
        isNaN: Number.isNaN(timestamp),
        isValid: !Number.isNaN(timestamp) && isValidTimestamp(timestamp),
    });

    if (Number.isNaN(timestamp) || !isValidTimestamp(timestamp)) {
        request.log.warn('[AUTH] Invalid timestamp', {
            timestampHeader,
            parsed: timestamp,
            age: timestampAge,
            maxAge: MAX_TIMESTAMP_AGE,
        });
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Validate nonce (must be non-empty)
    if (nonceHeader.trim().length === 0) {
        request.log.warn('[AUTH] Empty nonce');
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    // Get raw request body (captured by preParsing hook) or empty string for GET requests
    // Using raw body ensures consistent HMAC signatures regardless of JSON property order
    const bodyString = request.rawBody || '';

    // Build canonical message
    // Strip known API prefix to keep signatures stable even when the server is mounted under a base path
    const pathWithoutPrefix = request.url.startsWith(API_PREFIX)
        ? request.url.substring(API_PREFIX.length)
        : request.url;
    const canonicalPath = pathWithoutPrefix || '/';

    const canonicalMessage = buildCanonicalMessage(
        request.method,
        canonicalPath,
        timestampHeader,
        nonceHeader,
        bodyString
    );

    request.log.debug('[AUTH] Canonical message built', {
        method: request.method,
        originalUrl: request.url,
        canonicalPath,
        timestamp: timestampHeader,
        nonce: nonceHeader,
        bodyLength: bodyString.length,
        canonicalMessage,
    });

    // Compute expected HMAC signature
    const expectedSignature = computeHmac(canonicalMessage, apiSecret);

    request.log.debug('[AUTH] Signature comparison', {
        receivedSignature: signature,
        expectedSignature,
        match: signature === expectedSignature,
    });

    // Validate signature using constant-time comparison
    if (!validateSignature(signature, expectedSignature)) {
        request.log.warn('[AUTH] Signature mismatch', {
            received: signature,
            expected: expectedSignature,
        });
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Authentication failed',
        });
        return;
    }

    request.log.debug('[AUTH] Authentication successful');
    // Authentication successful
    done();
}
