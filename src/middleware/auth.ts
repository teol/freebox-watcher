import { type FastifyReply, type FastifyRequest, type HookHandlerDoneFunction } from 'fastify';

export function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
    done: HookHandlerDoneFunction
): void {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
        void reply.code(401).send({
            error: 'Unauthorized',
            message: 'Missing Authorization header',
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
