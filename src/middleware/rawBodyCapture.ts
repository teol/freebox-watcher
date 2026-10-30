import { type FastifyInstance } from 'fastify';

/**
 * Creates the error Fastify itself raises when a body exceeds the route limit
 */
function createBodyTooLargeError(limit: number): Error & { statusCode: number; code: string } {
    return Object.assign(new Error(`Request body is too large, maximum is ${limit} bytes`), {
        statusCode: 413,
        code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    });
}

/**
 * Register a preParsing hook to capture raw request body before JSON parsing
 * This ensures consistent HMAC signatures regardless of JSON property order
 *
 * The hook runs before any route-level authentication, so it enforces the route body limit
 * itself: an oversized body is rejected without being buffered.
 *
 * @param fastify Fastify instance
 */
export async function registerRawBodyCapture(fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preParsing', async (request, reply, payload) => {
        if (request.headers['content-type']?.includes('application/json')) {
            const limit = request.routeOptions.bodyLimit;
            if (Number(request.headers['content-length']) > limit) {
                throw createBodyTooLargeError(limit);
            }

            const chunks: Buffer[] = [];
            let received = 0;
            for await (const chunk of payload) {
                received += chunk.length;
                if (received > limit) {
                    throw createBodyTooLargeError(limit);
                }
                chunks.push(chunk);
            }
            const rawBody = Buffer.concat(chunks).toString('utf8');
            request.rawBody = rawBody;

            // Return a new readable stream for Fastify's JSON parser
            const { Readable } = await import('node:stream');
            const newPayload = new Readable();
            newPayload.push(rawBody);
            newPayload.push(null);
            return newPayload;
        }
    });
}
