import { timingSafeEqual } from 'node:crypto';
import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';

/**
 * Validates a token against the API key using constant-time comparison
 * to prevent timing attacks
 * @param token The token to validate
 * @param apiKey The expected API key
 * @returns true if the token is valid, false otherwise
 */
function isValidToken(token: string, apiKey: string): boolean {
    const tokenBuffer = Buffer.from(token);
    const apiKeyBuffer = Buffer.from(apiKey);

    // Check lengths match before calling timingSafeEqual (required by the API)
    if (tokenBuffer.length !== apiKeyBuffer.length) {
        return false;
    }

    return timingSafeEqual(tokenBuffer, apiKeyBuffer);
}

export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    const apiKey = process.env.API_KEY;

    // Prevent empty API key from being considered valid
    if (!apiKey || apiKey.trim().length === 0) {
        void reply.code(500).send({
            error: 'Internal Server Error',
            message: 'API key not configured',
        });
        return;
    }

    // Check for token in request body first (for compatibility with new payload format)
    const bodyToken = (request.body as { token?: string })?.token;

    if (bodyToken) {
        if (!isValidToken(bodyToken, apiKey)) {
            void reply.code(401).send({
                error: 'Unauthorized',
                message: 'Invalid API key',
            });
            return;
        }
        done();
        return;
    }

    // Fallback to Authorization header for backward compatibility
    const authHeader = request.headers.authorization;

    if (!authHeader) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Missing Authorization header or token in body',
        });
        return;
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer') {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid Authorization header format. Expected: Bearer <token>',
        });
        return;
    }

    if (!isValidToken(token, apiKey)) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API key',
        });
        return;
    }

    done();
}
