import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../../src/app.js';
import { API_PREFIX } from '../../src/constants/api.js';
import { hashToken } from '../../src/middleware/bearerAuth.js';
import { db } from '../../src/db/config.js';
import downtimeService from '../../src/services/downtime.js';
import type { HeartbeatsTable } from '../../src/types/database.js';
import { computeHmac, generateNonce, getCurrentTimestamp } from '../helpers.js';
import { setupDatabase, resetDatabase, teardownDatabase } from './setup.js';

const API_SECRET = 'integration-test-secret-with-32-chars!!';
const GRAPHQL_TOKEN = 'fbw_integration-token-with-enough-entropy-0123456789';

interface GraphqlResponseBody {
    data?: Record<string, unknown>;
    errors?: Array<{ message: string }>;
}

describe('API (database)', () => {
    let fastify: FastifyInstance;
    const originalEnv = { ...process.env };

    before(async () => {
        await setupDatabase();

        process.env.API_SECRET = API_SECRET;
        // Production mode avoids pino-pretty worker threads (see smoke tests)
        process.env.NODE_ENV = 'production';
        process.env.LOG_LEVEL = 'silent';
        process.env.GRAPHQL_ENABLED = 'true';
        process.env.GRAPHQL_API_TOKEN_HASH = hashToken(GRAPHQL_TOKEN).toString('hex');
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;

        fastify = await createApp({ rateLimitMax: 1000 });
        await fastify.ready();
    });

    beforeEach(resetDatabase);

    after(async () => {
        try {
            await fastify?.close();
        } finally {
            await teardownDatabase();
            process.env = originalEnv;
        }
    });

    async function postHeartbeat(payload: Record<string, unknown>) {
        const body = JSON.stringify(payload);
        const timestamp = getCurrentTimestamp();
        const nonce = generateNonce();

        return await fastify.inject({
            method: 'POST',
            url: `${API_PREFIX}/heartbeat`,
            headers: {
                authorization: `Bearer ${computeHmac('POST', '/heartbeat', timestamp, nonce, body, API_SECRET)}`,
                'signature-timestamp': timestamp,
                'signature-nonce': nonce,
                'content-type': 'application/json',
            },
            payload: body,
        });
    }

    async function graphql(query: string): Promise<GraphqlResponseBody> {
        const response = await fastify.inject({
            method: 'POST',
            url: `${API_PREFIX}/graphql`,
            headers: {
                authorization: `Bearer ${GRAPHQL_TOKEN}`,
                'content-type': 'application/json',
            },
            payload: JSON.stringify({ query }),
        });
        assert.strictEqual(response.statusCode, 200, response.body);
        return response.json<GraphqlResponseBody>();
    }

    it('should record a signed heartbeat', async () => {
        const response = await postHeartbeat({
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            media_state: 'ftth',
            sfp_pwr_rx_dbm: -19.5,
            active_devices: [{ mac: 'AA:BB:CC:11:22:33', name: 'Phone', type: 'smartphone' }],
        });

        assert.strictEqual(response.statusCode, 200, response.body);
        const { id } = response.json<{ id: number }>();
        const row = await db<HeartbeatsTable>('heartbeats').where('id', id).first();
        assert.strictEqual(row?.media_state, 'ftth');
        assert.strictEqual((await db('devices')).length, 1);
    });

    it('should not record a heartbeat with an invalid signature', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: `${API_PREFIX}/heartbeat`,
            headers: {
                authorization: 'Bearer invalid',
                'signature-timestamp': getCurrentTimestamp(),
                'signature-nonce': generateNonce(),
                'content-type': 'application/json',
            },
            payload: JSON.stringify({
                connection_state: 'up',
                timestamp: new Date().toISOString(),
            }),
        });

        assert.strictEqual(response.statusCode, 401);
        assert.strictEqual((await db('heartbeats')).length, 0);
    });

    it('should end the active downtime when an "up" heartbeat is received', async () => {
        const downtimeId = await downtimeService.createDowntimeEvent(
            new Date(Date.now() - 600_000)
        );

        const response = await postHeartbeat({
            connection_state: 'up',
            timestamp: new Date().toISOString(),
        });

        assert.strictEqual(response.statusCode, 200, response.body);
        assert.strictEqual(await downtimeService.getActiveDowntimeEvent(), null);
        const [event] = await downtimeService.getAllDowntimeEvents();
        assert.strictEqual(event.id, downtimeId);
        assert.ok((event.duration ?? 0) >= 600);
    });

    // Timeout: awaiting the never-settling alert would otherwise hang the test instead of failing it
    it('should not wait for the recovery notification before answering the heartbeat', {
        timeout: 5_000,
    }, async () => {
        const downtimeId = await downtimeService.createDowntimeEvent(
            new Date(Date.now() - 600_000)
        );
        const notificationService = fastify.notificationService;
        const originalIsEnabled = notificationService.isEnabled;
        const originalSendRecoveryAlert = notificationService.sendRecoveryAlert;
        const recoveryAlerts: number[] = [];
        notificationService.isEnabled = () => true;
        // Simulates an unresponsive Telegram API: the alert never settles
        notificationService.sendRecoveryAlert = (id: number) => {
            recoveryAlerts.push(id);
            return new Promise<void>(() => {});
        };

        try {
            const response = await postHeartbeat({
                connection_state: 'up',
                timestamp: new Date().toISOString(),
            });

            assert.strictEqual(response.statusCode, 200, response.body);
            assert.deepStrictEqual(recoveryAlerts, [downtimeId]);
            assert.strictEqual(await downtimeService.getActiveDowntimeEvent(), null);
        } finally {
            notificationService.isEnabled = originalIsEnabled;
            notificationService.sendRecoveryAlert = originalSendRecoveryAlert;
        }
    });

    it('should keep the downtime active when a non "up" heartbeat is received', async () => {
        await downtimeService.createDowntimeEvent(new Date(Date.now() - 600_000));

        await postHeartbeat({ connection_state: 'going_up', timestamp: new Date().toISOString() });

        assert.ok(await downtimeService.getActiveDowntimeEvent());
    });

    it('should expose the stored data through GraphQL', async () => {
        await postHeartbeat({
            connection_state: 'up',
            timestamp: '2026-11-13T10:00:00.000Z',
            ipv4: '82.67.197.112',
            bytes_down: 1_142_257_499_691,
            sfp_pwr_rx_dbm: -19.5,
        });
        const downtimeId = await downtimeService.createDowntimeEvent(
            new Date('2026-11-13T09:00:00.000Z')
        );

        const body = await graphql(`
            {
                lastHeartbeat {
                    id
                    status
                    timestamp
                    bytesDown
                    sfpPwrRxDbm
                }
                heartbeats(from: "2026-11-13T09:00:00Z", to: "2026-11-13T11:00:00Z") {
                    status
                }
                activeDowntime {
                    id
                    startedAt
                    endedAt
                    isActive
                }
            }
        `);

        assert.strictEqual(body.errors, undefined, JSON.stringify(body.errors));
        assert.deepStrictEqual(body.data?.lastHeartbeat, {
            id: (body.data?.lastHeartbeat as { id: string } | undefined)?.id,
            status: 'up',
            timestamp: '2026-11-13T10:00:00.000Z',
            bytesDown: 1_142_257_499_691,
            sfpPwrRxDbm: -19.5,
        });
        assert.deepStrictEqual(body.data?.heartbeats, [{ status: 'up' }]);
        assert.deepStrictEqual(body.data?.activeDowntime, {
            id: String(downtimeId),
            startedAt: '2026-11-13T09:00:00.000Z',
            endedAt: null,
            isActive: true,
        });
    });
});
