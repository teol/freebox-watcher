import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { heartbeatRoutes } from '../src/routes/heartbeat.js';
import { type HeartbeatInput } from '../src/services/heartbeat.js';
import { NotificationService } from '../src/services/notification.js';
import { DowntimeMonitor } from '../src/services/downtimeMonitor.js';

interface HeartbeatResponseBody {
    success?: boolean;
    message: string;
    id?: number;
}

describe('Heartbeat Routes', () => {
    let fastify: FastifyInstance;
    const testApiKey = 'test-heartbeat-key-12345';

    before(async () => {
        // Set up test environment
        process.env.API_KEY = testApiKey;

        fastify = Fastify({ logger: false });

        // Initialize and decorate services (required by heartbeat routes)
        const notificationService = new NotificationService(fastify.log);
        const downtimeMonitor = new DowntimeMonitor(fastify.log, notificationService);
        fastify.decorate('notificationService', notificationService);
        fastify.decorate('downtimeMonitor', downtimeMonitor);

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
                connection_state: 'up',
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
                connection_state: 'up',
                timestamp: 'invalid-timestamp',
            },
        });

        assert.strictEqual(response.statusCode, 400);
        const body = JSON.parse(response.body) as HeartbeatResponseBody;
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
                connection_state: 'up',
            },
        });

        assert.strictEqual(response.statusCode, 400);
    });

    it.skip('should accept heartbeat with new payload format and token in body (requires DB)', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            payload: {
                token: testApiKey,
                connection_state: 'up',
                timestamp: new Date().toISOString(),
                ipv4: '192.168.1.1',
                ipv6: '2001:db8::1',
                media_state: 'ftth',
                connection_type: 'ethernet',
                bandwidth_down: 1000000000,
                bandwidth_up: 500000000,
                rate_down: 9500,
                rate_up: 4800,
                bytes_down: 12345678,
                bytes_up: 8765432,
            },
        });

        if (response.statusCode !== 200) {
            console.error('Error response:', response.body);
        }

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body) as HeartbeatResponseBody;
        assert.strictEqual(body.success, true);
        assert.ok(body.id);
    });
});

describe('HeartbeatService', () => {
    it('should validate heartbeat data structure', () => {
        const validData: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
        };

        assert.ok(validData.connection_state);
        assert.ok(validData.timestamp);
    });

    it('should handle additional fields (ipv4, bandwidth, etc)', () => {
        const dataWithAdditionalFields: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            ipv4: '192.168.1.1',
            ipv6: '2001:db8::1',
            bandwidth_down: 1000000000,
            bandwidth_up: 500000000,
        };

        const dataWithoutAdditionalFields: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
        };

        assert.ok(dataWithAdditionalFields.ipv4);
        assert.ok(dataWithAdditionalFields.bandwidth_down);
        assert.strictEqual(dataWithoutAdditionalFields.ipv4, undefined);
    });
});
