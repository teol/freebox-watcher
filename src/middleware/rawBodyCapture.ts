import { type FastifyInstance } from 'fastify';

/**
 * Register a preParsing hook to capture raw request body before JSON parsing
 * This ensures consistent HMAC signatures regardless of JSON property order
 *
 * @param fastify Fastify instance
 */
export async function registerRawBodyCapture(fastify: FastifyInstance): Promise<void> {
    fastify.addHook('preParsing', async (request, reply, payload) => {
        if (request.headers['content-type']?.includes('application/json')) {
            const chunks: Buffer[] = [];
            for await (const chunk of payload) {
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
