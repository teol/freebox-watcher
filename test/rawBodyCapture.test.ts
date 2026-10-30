import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { Readable } from 'node:stream';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerRawBodyCapture } from '../src/middleware/rawBodyCapture.js';
import { graphqlRoutes } from '../src/routes/graphql.js';
import { createGraphqlSchema } from '../src/graphql/schema.js';
import { hashToken } from '../src/middleware/bearerAuth.js';

const ROUTE_BODY_LIMIT = 1024;
const OVERSIZED_BODY_SIZE = 5 * 1024 * 1024;

function oversizedJson(): string {
    return JSON.stringify({
        query: `{ lastHeartbeat { id } } #${'a'.repeat(OVERSIZED_BODY_SIZE)}`,
    });
}

describe('Raw body capture', () => {
    let fastify: FastifyInstance;
    // rawBody as seen by the last request, even when it was rejected before reaching a handler
    let capturedRawBody: string | undefined;

    before(async () => {
        fastify = Fastify({ logger: false });
        await registerRawBodyCapture(fastify);

        fastify.addHook('onSend', async (request) => {
            capturedRawBody = request.rawBody;
        });

        fastify.post('/limited', { bodyLimit: ROUTE_BODY_LIMIT }, async (request) => ({
            rawBody: request.rawBody,
        }));

        await fastify.register(graphqlRoutes, {
            schema: createGraphqlSchema({
                heartbeatService: {
                    getLastHeartbeat: async () => null,
                    getHeartbeatById: async () => null,
                    getHeartbeatsPage: async () => [],
                },
                downtimeService: {
                    getActiveDowntimeEvent: async () => null,
                    getDowntimeEventsPage: async () => [],
                },
            }),
            tokenHash: hashToken('fbw_raw-body-capture-test-token-0123456789'),
            rateLimitMax: 1000,
        });
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should capture bodies within the route limit', async () => {
        const payload = '{"b":1,  "a":2}';
        const response = await fastify.inject({
            method: 'POST',
            url: '/limited',
            headers: { 'content-type': 'application/json' },
            payload,
        });

        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(response.json<{ rawBody: string }>().rawBody, payload);
    });

    it('should reject an oversized body announced by Content-Length without buffering it', async () => {
        capturedRawBody = undefined;
        const response = await fastify.inject({
            method: 'POST',
            url: '/limited',
            headers: { 'content-type': 'application/json' },
            payload: oversizedJson(),
        });

        assert.strictEqual(response.statusCode, 413);
        assert.strictEqual(capturedRawBody, undefined);
    });

    it('should reject an oversized chunked body without buffering it', async () => {
        capturedRawBody = undefined;
        const response = await fastify.inject({
            method: 'POST',
            url: '/limited',
            headers: { 'content-type': 'application/json' },
            payload: Readable.from([Buffer.from(oversizedJson())]),
        });

        assert.strictEqual(response.statusCode, 413);
        assert.strictEqual(capturedRawBody, undefined);
    });

    it('should not buffer an oversized unauthenticated GraphQL body', async () => {
        capturedRawBody = undefined;
        const response = await fastify.inject({
            method: 'POST',
            url: '/graphql',
            headers: { 'content-type': 'application/json' },
            payload: oversizedJson(),
        });

        assert.strictEqual(response.statusCode, 413);
        assert.strictEqual(capturedRawBody, undefined);
    });

    it('should still reject a small unauthenticated GraphQL body with 401', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/graphql',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({ query: '{ lastHeartbeat { id } }' }),
        });

        assert.strictEqual(response.statusCode, 401);
    });
});
