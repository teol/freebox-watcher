import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';

export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    // Check for token in request body first (for compatibility with new payload format)
    const bodyToken = (request.body as { token?: string })?.token;

    if (bodyToken) {
        if (bodyToken !== process.env.API_KEY) {
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

    if (token !== process.env.API_KEY) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Invalid API key',
        });
        return;
    }

    done();
}
