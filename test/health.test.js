import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import { healthRoutes } from '../src/routes/health.js';

describe('Health Routes', () => {
    let fastify;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.register(healthRoutes);
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should return health status', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/health',
        });

        // Accept both 200 (DB connected) and 503 (DB not available in test environment)
        assert.ok([200, 503].includes(response.statusCode));
        const body = JSON.parse(response.body);

        assert.ok(body.status);
        assert.ok(typeof body.uptime === 'number');
        assert.ok(body.timestamp);
    });

    it('should include uptime in response', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/health',
        });

        const body = JSON.parse(response.body);
        assert.ok(body.uptime >= 0);
    });

    it('should return valid ISO timestamp', async () => {
        const response = await fastify.inject({
            method: 'GET',
            url: '/health',
        });

        const body = JSON.parse(response.body);
        const timestamp = new Date(body.timestamp);
        assert.ok(!isNaN(timestamp.getTime()));
    });
});
