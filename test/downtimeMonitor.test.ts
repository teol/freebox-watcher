import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import heartbeatService from '../src/services/heartbeat.js';
import downtimeService from '../src/services/downtime.js';
import { DowntimeMonitor } from '../src/services/downtimeMonitor.js';
import { NotificationService } from '../src/services/notification.js';

describe('DowntimeMonitor', () => {
    let fastify: FastifyInstance;
    let notificationService: NotificationService;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
        notificationService = new NotificationService(fastify.log);
    });

    beforeEach(() => {
        delete process.env.DOWNTIME_CHECK_INTERVAL;
        delete process.env.DOWNTIME_CONFIRMATION_DELAY;
        delete process.env.HEARTBEAT_TIMEOUT;
    });

    after(async () => {
        await fastify.close();
    });

    it('should create an instance with default configuration', () => {
        delete process.env.DOWNTIME_CHECK_INTERVAL;
        delete process.env.DOWNTIME_CONFIRMATION_DELAY;
        delete process.env.HEARTBEAT_TIMEOUT;

        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.ok(monitor);
    });

    it('should read configuration from environment variables', () => {
        process.env.DOWNTIME_CHECK_INTERVAL = '30000';
        process.env.DOWNTIME_CONFIRMATION_DELAY = '900000';
        process.env.HEARTBEAT_TIMEOUT = '180000';

        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.ok(monitor);

        delete process.env.DOWNTIME_CHECK_INTERVAL;
        delete process.env.DOWNTIME_CONFIRMATION_DELAY;
        delete process.env.HEARTBEAT_TIMEOUT;
    });

    it('should have start and stop methods', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.strictEqual(typeof monitor.start, 'function');
        assert.strictEqual(typeof monitor.stop, 'function');
    });

    it('should have markDowntimeEnded method', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.strictEqual(typeof monitor.markDowntimeEnded, 'function');
    });

    it('should start and stop monitoring without errors', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        // Should not throw when starting
        assert.doesNotThrow(() => {
            monitor.start();
        });

        // Should not throw when stopping
        assert.doesNotThrow(() => {
            monitor.stop();
        });
    });

    it('should not start twice', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        monitor.start();
        // Second start should be ignored (logged as warning)
        monitor.start();

        monitor.stop();
    });

    it('should mark downtime as ended', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.doesNotThrow(() => {
            monitor.markDowntimeEnded(123);
        });
    });

    it('should handle multiple downtime IDs', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        assert.doesNotThrow(() => {
            monitor.markDowntimeEnded(1);
            monitor.markDowntimeEnded(2);
            monitor.markDowntimeEnded(3);
        });
    });

    it('should stop gracefully even if not started', () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        // Should not throw when stopping without starting
        assert.doesNotThrow(() => {
            monitor.stop();
        });
    });

    it('should cleanup on stop', (t, done) => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);

        monitor.start();

        // Give it a moment to start
        setTimeout(() => {
            monitor.stop();

            // After stop, it should be safe to restart
            assert.doesNotThrow(() => {
                monitor.start();
                monitor.stop();
            });

            done();
        }, 100);
    });

    it('should create downtime and notify when heartbeat is stale', async () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);
        const originalGetActiveDowntimeEvent = downtimeService.getActiveDowntimeEvent;
        const originalGetLastHeartbeat = heartbeatService.getLastHeartbeat;
        const originalCreateDowntimeEvent = downtimeService.createDowntimeEvent;
        const originalIsEnabled = notificationService.isEnabled;
        const originalSendDowntimeAlert = notificationService.sendDowntimeAlert;

        let createdDowntimeArgs: { startedAt: Date; notes: string | null } | null = null;
        const notificationCalls: Array<{ data: unknown; heartbeatTimeoutMs: number }> = [];

        downtimeService.getActiveDowntimeEvent = async () => null;
        heartbeatService.getLastHeartbeat = async () => ({
            timestamp: new Date(Date.now() - ((monitor as any).heartbeatTimeoutMs + 60000)),
        }) as any;
        downtimeService.createDowntimeEvent = async (startedAt: Date, notes: string | null) => {
            createdDowntimeArgs = { startedAt, notes };
            return 99;
        };
        notificationService.isEnabled = () => true;
        notificationService.sendDowntimeAlert = async (data: unknown, heartbeatTimeoutMs: number) => {
            notificationCalls.push({ data, heartbeatTimeoutMs });
        };

        try {
            await (monitor as any).checkDowntime();

            assert.ok(createdDowntimeArgs);
            const args = createdDowntimeArgs as { startedAt: Date; notes: string | null };
            assert.strictEqual(args.notes, 'Automatically detected downtime');
            assert.strictEqual(notificationCalls.length, 1);
            assert.strictEqual(
                notificationCalls[0].heartbeatTimeoutMs,
                (monitor as any).heartbeatTimeoutMs
            );
        } finally {
            downtimeService.getActiveDowntimeEvent = originalGetActiveDowntimeEvent;
            heartbeatService.getLastHeartbeat = originalGetLastHeartbeat;
            downtimeService.createDowntimeEvent = originalCreateDowntimeEvent;
            notificationService.isEnabled = originalIsEnabled;
            notificationService.sendDowntimeAlert = originalSendDowntimeAlert;
        }
    });

    it('should send confirmation notification after confirmation delay', async () => {
        const monitor = new DowntimeMonitor(fastify.log, notificationService);
        const originalGetActiveDowntimeEvent = downtimeService.getActiveDowntimeEvent;
        const originalIsEnabled = notificationService.isEnabled;
        const originalSendDowntimeConfirmedAlert = notificationService.sendDowntimeConfirmedAlert;

        const startedAt = new Date(Date.now() - ((monitor as any).confirmationDelayMs + 120000));
        const notificationCalls: Array<{ data: unknown; confirmationDelayMs: number }> = [];

        downtimeService.getActiveDowntimeEvent = async () => ({
            id: 77,
            started_at: startedAt,
        }) as any;
        notificationService.isEnabled = () => true;
        notificationService.sendDowntimeConfirmedAlert = async (
            data: unknown,
            confirmationDelayMs: number
        ) => {
            notificationCalls.push({ data, confirmationDelayMs });
        };

        try {
            await (monitor as any).checkDowntime();

            assert.strictEqual(notificationCalls.length, 1);
            assert.strictEqual(
                notificationCalls[0].confirmationDelayMs,
                (monitor as any).confirmationDelayMs
            );
        } finally {
            downtimeService.getActiveDowntimeEvent = originalGetActiveDowntimeEvent;
            notificationService.isEnabled = originalIsEnabled;
            notificationService.sendDowntimeConfirmedAlert = originalSendDowntimeConfirmedAlert;
        }
    });
});
