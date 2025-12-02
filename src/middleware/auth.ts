import { timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';

/**
 * Minimum API key length for security
 */
const MIN_API_KEY_LENGTH = 16;

/**
 * Validates a token against the API key using constant-time comparison
 * to prevent timing attacks
 * @param token The token to validate
 * @param apiKey The expected API key
 * @returns true if the token is valid, false otherwise
 */
function isValidToken(token: string | undefined, apiKey: string): boolean {
    if (!token) {
        return false;
    }

    const tokenBuffer = Buffer.from(token);
    const apiKeyBuffer = Buffer.from(apiKey);

    // Check lengths match before calling timingSafeEqual (required by the API)
    if (tokenBuffer.length !== apiKeyBuffer.length) {
        return false;
    }

    return timingSafeEqual(tokenBuffer, apiKeyBuffer);
}

/**
 * Extracts the Bearer token from the Authorization header
 * @param authHeader The Authorization header value
 * @returns The token if valid format, undefined otherwise
 */
function extractBearerToken(authHeader: string | undefined): string | undefined {
    if (!authHeader) {
        return undefined;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return undefined;
    }

    return parts[1];
}

/**
 * Authentication middleware using Bearer token authentication
 *
 * Authenticates requests using the Authorization header with Bearer token scheme.
 * Format: Authorization: Bearer <token>
 *
 * For backward compatibility, also supports token in request body (deprecated).
 */
export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    const apiKey = process.env.API_KEY;

    // Validate API key configuration
    if (!apiKey || apiKey.trim().length === 0) {
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: 'API key not configured',
        });
        return;
    }

    // Validate API key meets minimum security requirements
    if (apiKey.length < MIN_API_KEY_LENGTH) {
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: `API key must be at least ${MIN_API_KEY_LENGTH} characters`,
        });
        return;
    }

    // PRIMARY: Check Authorization header with Bearer token (recommended)
    const authHeader = request.headers.authorization;
    const bearerToken = extractBearerToken(authHeader);

    if (bearerToken) {
        if (isValidToken(bearerToken, apiKey)) {
            done();
            return;
        }

        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API token',
        });
        return;
    }

    // FALLBACK: Check for token in request body (deprecated, for backward compatibility)
    const bodyToken = (request.body as { token?: string })?.token;

    if (bodyToken) {
        if (isValidToken(bodyToken, apiKey)) {
            done();
            return;
        }

        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API token',
        });
        return;
    }

    // No valid authentication provided
    void reply.code(401).send({
        error: 'Unauthorized',
        message: 'Missing authentication. Use Authorization: Bearer <token> header',
    });
}
