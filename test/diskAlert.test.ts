import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { DiskAlertService } from '../src/services/diskAlert.js';
import { NotificationService } from '../src/services/notification.js';

describe('DiskAlertService', () => {
    let fastify: FastifyInstance;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(() => {
        delete process.env.DISK_ALERT_ENABLED;
        delete process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD;
        delete process.env.DISK_ALERT_COOLDOWN;
    });

    after(async () => {
        await fastify.close();
    });

    describe('isEnabled', () => {
        it('should be disabled by default', () => {
            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            assert.strictEqual(service.isEnabled(), false);
        });

        it('should be disabled when DISK_ALERT_ENABLED is "false"', () => {
            process.env.DISK_ALERT_ENABLED = 'false';
            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            assert.strictEqual(service.isEnabled(), false);
        });

        it('should be enabled when DISK_ALERT_ENABLED is "true"', () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            assert.strictEqual(service.isEnabled(), true);
        });
    });

    describe('checkAndAlert', () => {
        it('should not send alert when service is disabled', async () => {
            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);

            assert.strictEqual(sendCalls.length, 0);
        });

        it('should not send alert when Telegram is not configured', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            const notificationService = new NotificationService(fastify.log);
            // notificationService.isEnabled() is false (no token set)
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);

            assert.strictEqual(sendCalls.length, 0);
        });

        it('should not send alert when free space is above threshold', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD = '10';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            // 15% free — above the 10% threshold
            await service.checkAndAlert(150_000_000_000, 1_000_000_000_000);

            assert.strictEqual(sendCalls.length, 0);
        });

        it('should send alert when free space is below threshold', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD = '10';
            process.env.DISK_ALERT_COOLDOWN = '0';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: Array<{ message: string }> = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (_chatId: string, message: string) => {
                    sendCalls.push({ message });
                },
            };

            // 5% free — below the 10% threshold
            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);

            assert.strictEqual(sendCalls.length, 1);
            assert.match(sendCalls[0].message, /Disk Space Low/);
            assert.match(sendCalls[0].message, /5\.0%/);
        });

        it('should suppress alert during cooldown period', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD = '10';
            process.env.DISK_ALERT_COOLDOWN = '3600000';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            // First call: alert should fire
            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);
            assert.strictEqual(sendCalls.length, 1);

            // Second call immediately after: suppressed by cooldown
            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);
            assert.strictEqual(sendCalls.length, 1);
        });

        it('should send alert again once cooldown has elapsed', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD = '10';
            process.env.DISK_ALERT_COOLDOWN = '0';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);
            await service.checkAndAlert(50_000_000_000, 1_000_000_000_000);

            // Both calls should fire when cooldown is 0
            assert.strictEqual(sendCalls.length, 2);
        });

        it('should not send alert when disk_total_bytes is zero', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            await service.checkAndAlert(0, 0);

            assert.strictEqual(sendCalls.length, 0);
        });

        it('should use custom threshold from env var', async () => {
            process.env.DISK_ALERT_ENABLED = 'true';
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD = '20';
            process.env.DISK_ALERT_COOLDOWN = '0';

            const notificationService = new NotificationService(fastify.log);
            const service = new DiskAlertService(fastify.log, notificationService);

            const sendCalls: unknown[] = [];
            (notificationService as any).enabled = true;
            (notificationService as any).chatId = 'chat-123';
            (notificationService as any).bot = {
                sendMessage: async (...args: unknown[]) => {
                    sendCalls.push(args);
                },
            };

            // 15% free — below the custom 20% threshold
            await service.checkAndAlert(150_000_000_000, 1_000_000_000_000);
            assert.strictEqual(sendCalls.length, 1);

            // 25% free — above the custom 20% threshold
            await service.checkAndAlert(250_000_000_000, 1_000_000_000_000);
            assert.strictEqual(sendCalls.length, 1);
        });
    });
});
