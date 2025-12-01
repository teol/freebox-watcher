import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { authMiddleware } from '../src/middleware/auth.js';

describe('Authentication Middleware', () => {
    let fastify: FastifyInstance;

    before(async () => {
        // Set up test environment
        process.env.API_KEY = 'test-api-key-12345';

        fastify = Fastify({ logger: false });

        // Register test routes with auth middleware
        fastify.get('/test-protected', { preHandler: authMiddleware }, async () => {
            return { message: 'success' };
        });

        fastify.post('/test-post-protected', { preHandler: authMiddleware }, async () => {
            return { message: 'success' };
        });

        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should reject requests without Authorization header or token in body', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/test-protected',
        });

        assert.strictEqual(response.statusCode, 401);
        const body = JSON.parse(response.body) as { error: string; message: string };
        assert.strictEqual(body.error, 'Unauthorized');
        assert.strictEqual(body.message, 'Missing Authorization header or token in body');
    });

    it('should reject requests with invalid Authorization header format', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/test-protected',
            headers: {
                authorization: 'InvalidFormat token',
            },
        });

        assert.strictEqual(response.statusCode, 401);
        const body = JSON.parse(response.body) as { error: string; message: string };
        assert.strictEqual(body.error, 'Unauthorized');
        assert.ok(body.message.includes('Invalid Authorization header format'));
    });

    it('should reject requests with invalid API key', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/test-protected',
            headers: {
                authorization: 'Bearer wrong-api-key',
            },
        });

        assert.strictEqual(response.statusCode, 401);
        const body = JSON.parse(response.body) as { error: string; message: string };
        assert.strictEqual(body.error, 'Unauthorized');
        assert.strictEqual(body.message, 'Invalid API key');
    });

    it('should accept requests with valid API key in Authorization header', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/test-protected',
            headers: {
                authorization: 'Bearer test-api-key-12345',
            },
        });

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body) as { message: string };
        assert.strictEqual(body.message, 'success');
    });

    it('should accept POST requests with valid token in body', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/test-post-protected',
            payload: {
                token: 'test-api-key-12345',
                data: 'some data',
            },
        });

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body) as { message: string };
        assert.strictEqual(body.message, 'success');
    });

    it('should reject POST requests with invalid token in body', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/test-post-protected',
            payload: {
                token: 'wrong-api-key',
                data: 'some data',
            },
        });

        assert.strictEqual(response.statusCode, 401);
        const body = JSON.parse(response.body) as { error: string; message: string };
        assert.strictEqual(body.error, 'Unauthorized');
        assert.strictEqual(body.message, 'Invalid API key');
    });
});
