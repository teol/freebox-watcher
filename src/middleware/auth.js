/**
 * Authentication middleware for Fastify
 * Validates API key from Authorization header
 */
export function authMiddleware(request, reply, done) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
        return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Missing Authorization header',
        });
    }

    const [type, token] = authHeader.split(' ');

    if (type !== 'Bearer') {
        return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid Authorization header format. Expected: Bearer <token>',
        });
    }

    if (token !== process.env.API_KEY) {
        return reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API key',
        });
    }

    done();
}
