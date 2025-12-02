import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHmac, randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { authMiddleware } from '../src/middleware/auth.js';

describe('HMAC Authentication Middleware', () => {
    let fastify: FastifyInstance;
    const VALID_API_SECRET = 'test-api-secret-32-characters-long-for-hmac';
    const GENERIC_ERROR_MESSAGE = 'Authentication failed';

    /**
     * Helper function to compute HMAC signature
     */
    function computeHmac(method: string, path: string, timestamp: string, nonce: string): string {
        const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}`;
        return createHmac('sha256', VALID_API_SECRET).update(message).digest('base64url');
    }

    /**
     * Helper function to get current Unix timestamp
     */
    function getCurrentTimestamp(): string {
        return Math.floor(Date.now() / 1000).toString();
    }

    /**
     * Helper function to generate a random nonce
     */
    function generateNonce(): string {
        return randomBytes(16).toString('hex');
    }

    before(async () => {
        // Set up test environment
        process.env.API_SECRET = VALID_API_SECRET;

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

    describe('HMAC Signature Validation', () => {
        it('should reject requests without Authorization header', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.error, 'Unauthorized');
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject requests without Signature-Timestamp header', async () => {
            const nonce = generateNonce();
            const signature = 'fake-signature';

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.error, 'Unauthorized');
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject requests without Signature-Nonce header', async () => {
            const timestamp = getCurrentTimestamp();
            const signature = 'fake-signature';

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.error, 'Unauthorized');
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject requests with invalid signature', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = 'invalid-signature-that-wont-match';

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.error, 'Unauthorized');
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should accept requests with valid HMAC signature', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = computeHmac('GET', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 200);
            const body = JSON.parse(response.body) as { message: string };
            assert.strictEqual(body.message, 'success');
        });

        it('should accept POST requests with valid HMAC signature', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = computeHmac('POST', '/test-post-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'POST',
                url: '/test-post-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
                payload: {
                    data: 'some data',
                },
            });

            assert.strictEqual(response.statusCode, 200);
            const body = JSON.parse(response.body) as { message: string };
            assert.strictEqual(body.message, 'success');
        });

        it('should reject signature for wrong HTTP method', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            // Generate signature for POST but send GET
            const signature = computeHmac('POST', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject signature for wrong path', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            // Generate signature for different path
            const signature = computeHmac('GET', '/wrong-path', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });
    });

    describe('Timestamp Validation', () => {
        it('should reject expired timestamp (older than 60 seconds)', async () => {
            const nonce = generateNonce();
            const expiredTimestamp = (Math.floor(Date.now() / 1000) - 61).toString(); // 61 seconds ago
            const signature = computeHmac('GET', '/test-protected', expiredTimestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': expiredTimestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject future timestamp (more than 1 minute ahead)', async () => {
            const nonce = generateNonce();
            const futureTimestamp = (Math.floor(Date.now() / 1000) + 120).toString(); // 2 minutes in future
            const signature = computeHmac('GET', '/test-protected', futureTimestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': futureTimestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject invalid timestamp format', async () => {
            const nonce = generateNonce();
            const invalidTimestamp = 'not-a-timestamp';
            const signature = computeHmac('GET', '/test-protected', invalidTimestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': invalidTimestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should accept timestamp within valid window', async () => {
            const nonce = generateNonce();
            const timestamp = getCurrentTimestamp();
            const signature = computeHmac('GET', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 200);
        });
    });

    describe('Nonce Validation', () => {
        it('should reject empty nonce', async () => {
            const timestamp = getCurrentTimestamp();
            const emptyNonce = '';
            const signature = computeHmac('GET', '/test-protected', timestamp, emptyNonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': emptyNonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should reject whitespace-only nonce', async () => {
            const timestamp = getCurrentTimestamp();
            const whitespaceNonce = '   ';
            const signature = computeHmac('GET', '/test-protected', timestamp, whitespaceNonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': whitespaceNonce,
                },
            });

            assert.strictEqual(response.statusCode, 401);
            const body = JSON.parse(response.body) as { error: string; message: string };
            assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
        });

        it('should accept valid nonce', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = computeHmac('GET', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 200);
        });
    });

    describe('Bearer Scheme Compatibility', () => {
        it('should accept Bearer scheme in lowercase', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = computeHmac('GET', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `bearer ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 200);
        });

        it('should accept Bearer scheme with multiple spaces', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();
            const signature = computeHmac('GET', '/test-protected', timestamp, nonce);

            const response = await fastify.inject({
                method: 'GET',
                url: '/test-protected',
                headers: {
                    authorization: `Bearer    ${signature}`,
                    'signature-timestamp': timestamp,
                    'signature-nonce': nonce,
                },
            });

            assert.strictEqual(response.statusCode, 200);
        });
    });

    describe('Error Message Consistency', () => {
        it('should return same error message for all failure cases', async () => {
            const timestamp = getCurrentTimestamp();
            const nonce = generateNonce();

            // Test various failure scenarios
            const testCases = [
                { headers: {} }, // Missing all headers
                { headers: { authorization: 'Bearer fake' } }, // Missing timestamp & nonce
                { headers: { authorization: 'Bearer fake', 'signature-timestamp': timestamp } }, // Missing nonce
                {
                    headers: {
                        authorization: 'Bearer wrong',
                        'signature-timestamp': timestamp,
                        'signature-nonce': nonce,
                    },
                }, // Wrong signature
            ];

            for (const testCase of testCases) {
                const response = await fastify.inject({
                    method: 'GET',
                    url: '/test-protected',
                    headers: testCase.headers,
                });

                assert.strictEqual(response.statusCode, 401);
                const body = JSON.parse(response.body) as { error: string; message: string };
                assert.strictEqual(body.message, GENERIC_ERROR_MESSAGE);
            }
        });
    });
});
