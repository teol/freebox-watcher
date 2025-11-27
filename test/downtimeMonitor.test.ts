import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
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
});
