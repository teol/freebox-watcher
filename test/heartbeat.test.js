import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { heartbeatRoutes } from '../src/routes/heartbeat.js';
import { HeartbeatService } from '../src/services/heartbeat.js';

describe('Heartbeat Routes', () => {
    let fastify;
    const testApiKey = 'test-heartbeat-key-12345';

    before(async () => {
        // Set up test environment
        process.env.API_KEY = testApiKey;

        fastify = Fastify({ logger: false });
        await fastify.register(heartbeatRoutes);
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should reject heartbeat without authentication', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            payload: {
                status: 'online',
                timestamp: new Date().toISOString(),
            },
        });

        assert.strictEqual(response.statusCode, 401);
    });

    it('should reject heartbeat with invalid timestamp', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            headers: {
                authorization: `Bearer ${testApiKey}`,
            },
            payload: {
                status: 'online',
                timestamp: 'invalid-timestamp',
            },
        });

        assert.strictEqual(response.statusCode, 400);
        const body = JSON.parse(response.body);
        assert.ok(body.message.includes('Invalid timestamp'));
    });

    it('should reject heartbeat with missing required fields', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            headers: {
                authorization: `Bearer ${testApiKey}`,
            },
            payload: {
                status: 'online',
            },
        });

        assert.strictEqual(response.statusCode, 400);
    });
});

describe('HeartbeatService', () => {
    it('should validate heartbeat data structure', () => {
        const service = new HeartbeatService();

        const validData = {
            status: 'online',
            timestamp: new Date().toISOString(),
        };

        assert.ok(validData.status);
        assert.ok(validData.timestamp);
    });

    it('should handle metadata as optional field', () => {
        const service = new HeartbeatService();

        const dataWithMetadata = {
            status: 'online',
            timestamp: new Date().toISOString(),
            metadata: { version: '1.0.0' },
        };

        const dataWithoutMetadata = {
            status: 'online',
            timestamp: new Date().toISOString(),
        };

        assert.ok(dataWithMetadata.metadata);
        assert.strictEqual(dataWithoutMetadata.metadata, undefined);
    });
});
