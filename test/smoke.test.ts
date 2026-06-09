import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { type FastifyInstance } from 'fastify';
import { createApp } from '../src/app.js';
import { API_PREFIX } from '../src/constants/api.js';

/**
 * Smoke tests: verify that the application initializes correctly and that
 * key HTTP endpoints respond as expected. These tests use the real createApp()
 * factory to catch regressions introduced by dependency updates (plugins, middleware,
 * routing). No database connection is required.
 */
describe('Application smoke tests', () => {
    let fastify: FastifyInstance;

    before(async () => {
        process.env.API_SECRET = 'test-secret-32-chars-for-smoke-tests!!';
        // Use production mode to avoid pino-pretty worker threads, which create
        // undefined entries in require.cache that trip Fastify's getPluginName.
        process.env.NODE_ENV = 'production';
        fastify = await createApp();
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should initialize all plugins and routes without throwing', () => {
        assert.ok(fastify, 'Fastify instance should be created');
    });

    it('should respond with 404 for unknown routes', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/nonexistent-route',
        });
        assert.strictEqual(response.statusCode, 404);
    });

    it('should have the heartbeat route registered and reject unauthenticated requests with 401', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: `${API_PREFIX}/heartbeat`,
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({
                connection_state: 'up',
                timestamp: new Date().toISOString(),
            }),
        });
        assert.strictEqual(response.statusCode, 401);
    });

    it('should include rate-limit headers in responses (@fastify/rate-limit plugin)', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: `${API_PREFIX}/heartbeat`,
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify({
                connection_state: 'up',
                timestamp: new Date().toISOString(),
            }),
        });
        assert.ok(
            response.headers['x-ratelimit-limit'],
            'x-ratelimit-limit header should be present'
        );
    });
});
