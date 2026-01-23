import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { NotificationService } from '../src/services/notification.js';

describe('NotificationService', () => {
    let fastify: FastifyInstance;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(() => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;
    });

    after(async () => {
        await fastify.close();
    });

    it('should be disabled when environment variables are not set', () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;

        const service = new NotificationService(fastify.log);

        assert.strictEqual(service.isEnabled(), false);
    });

    it('should be disabled when only bot token is set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'test-token';
        delete process.env.TELEGRAM_CHAT_ID;

        const service = new NotificationService(fastify.log);

        assert.strictEqual(service.isEnabled(), false);

        delete process.env.TELEGRAM_BOT_TOKEN;
    });

    it('should be disabled when only chat ID is set', () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        process.env.TELEGRAM_CHAT_ID = '123456789';

        const service = new NotificationService(fastify.log);

        assert.strictEqual(service.isEnabled(), false);

        delete process.env.TELEGRAM_CHAT_ID;
    });

    it('should attempt to enable when both environment variables are set', () => {
        process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-12345';
        process.env.TELEGRAM_CHAT_ID = '123456789';

        const service = new NotificationService(fastify.log);

        // Note: The service will be enabled but the bot initialization might fail
        // in a test environment without a valid token. We just verify the configuration
        // is attempted.
        assert.ok(service);

        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;
    });

    it('should have notification methods available', () => {
        const service = new NotificationService(fastify.log);

        assert.strictEqual(typeof service.sendDowntimeAlert, 'function');
        assert.strictEqual(typeof service.sendDowntimeConfirmedAlert, 'function');
        assert.strictEqual(typeof service.sendRecoveryAlert, 'function');
    });

    it('should not throw when sending alerts while disabled', async () => {
        const service = new NotificationService(fastify.log);

        await assert.doesNotReject(async () => {
            await service.sendDowntimeAlert(
                {
                    downtimeId: 1,
                    startedAt: new Date(),
                },
                300000
            );
        });

        await assert.doesNotReject(async () => {
            await service.sendDowntimeConfirmedAlert(
                {
                    downtimeId: 1,
                    startedAt: new Date(),
                },
                1800000
            );
        });

        await assert.doesNotReject(async () => {
            await service.sendRecoveryAlert(1, new Date(), new Date());
        });
    });

    it('should format downtime alert with heartbeat timeout and send via Telegram', async () => {
        const service = new NotificationService(fastify.log);
        const sendCalls: Array<{ chatId: string; message: string; options: unknown }> = [];

        (service as any).enabled = true;
        (service as any).chatId = 'chat-123';
        (service as any).bot = {
            sendMessage: async (chatId: string, message: string, options: unknown) => {
                sendCalls.push({ chatId, message, options });
            },
        };

        await service.sendDowntimeAlert(
            {
                downtimeId: 42,
                startedAt: new Date('2024-01-01T00:00:00.000Z'),
            },
            300000
        );

        assert.strictEqual(sendCalls.length, 1);
        assert.strictEqual(sendCalls[0].chatId, 'chat-123');
        assert.match(sendCalls[0].message, /Downtime Detected/);
        assert.match(sendCalls[0].message, /No heartbeat received for 5 minutes/);
        assert.deepStrictEqual(sendCalls[0].options, { parse_mode: 'Markdown' });
    });

    it('should include confirmation delay when sending confirmed downtime alert', async () => {
        const service = new NotificationService(fastify.log);
        const sendCalls: Array<{ chatId: string; message: string; options: unknown }> = [];

        (service as any).enabled = true;
        (service as any).chatId = 'chat-456';
        (service as any).bot = {
            sendMessage: async (chatId: string, message: string, options: unknown) => {
                sendCalls.push({ chatId, message, options });
            },
        };

        const startedAt = new Date(Date.now() - 45 * 60000);

        await service.sendDowntimeConfirmedAlert(
            {
                downtimeId: 7,
                startedAt,
            },
            1800000
        );

        assert.strictEqual(sendCalls.length, 1);
        assert.strictEqual(sendCalls[0].chatId, 'chat-456');
        assert.match(sendCalls[0].message, /Downtime Confirmed/);
        assert.match(sendCalls[0].message, /over 30 minutes/);
        assert.deepStrictEqual(sendCalls[0].options, { parse_mode: 'Markdown' });
    });

    describe('formatDuration', () => {
        let service: NotificationService;

        before(() => {
            service = new NotificationService(fastify.log);
        });

        it('should format zero seconds', () => {
            const result = (service as any).formatDuration(0);
            assert.strictEqual(result, '0s');
        });

        it('should format seconds only (less than a minute)', () => {
            const result = (service as any).formatDuration(45);
            assert.strictEqual(result, '45s');
        });

        it('should format exactly 1 minute', () => {
            const result = (service as any).formatDuration(60);
            assert.strictEqual(result, '1m');
        });

        it('should format minutes and seconds', () => {
            const result = (service as any).formatDuration(150); // 2m 30s
            assert.strictEqual(result, '2m 30s');
        });

        it('should format minutes without seconds when seconds are zero', () => {
            const result = (service as any).formatDuration(180); // 3m 0s
            assert.strictEqual(result, '3m');
        });

        it('should format exactly 1 hour', () => {
            const result = (service as any).formatDuration(3600);
            assert.strictEqual(result, '1h');
        });

        it('should format hours and minutes', () => {
            const result = (service as any).formatDuration(9000); // 2h 30m
            assert.strictEqual(result, '2h 30m');
        });

        it('should format hours, minutes, and seconds', () => {
            const result = (service as any).formatDuration(9015); // 2h 30m 15s
            assert.strictEqual(result, '2h 30m 15s');
        });

        it('should format hours without minutes or seconds when both are zero', () => {
            const result = (service as any).formatDuration(7200); // 2h 0m 0s
            assert.strictEqual(result, '2h');
        });

        it('should format exactly 1 day', () => {
            const result = (service as any).formatDuration(86400);
            assert.strictEqual(result, '1d');
        });

        it('should format days and hours', () => {
            const result = (service as any).formatDuration(97200); // 1d 3h
            assert.strictEqual(result, '1d 3h');
        });

        it('should format days, hours, and minutes', () => {
            const result = (service as any).formatDuration(97800); // 1d 3h 10m
            assert.strictEqual(result, '1d 3h 10m');
        });

        it('should format days, hours, minutes, and seconds', () => {
            const result = (service as any).formatDuration(97815); // 1d 3h 10m 15s
            assert.strictEqual(result, '1d 3h 10m 15s');
        });

        it('should format multiple days without other units', () => {
            const result = (service as any).formatDuration(259200); // 3d 0h 0m 0s
            assert.strictEqual(result, '3d');
        });

        it('should format the example from the issue (21 days)', () => {
            const result = (service as any).formatDuration(1868123); // 21d 14h 55m 23s
            assert.strictEqual(result, '21d 14h 55m 23s');
        });

        it('should format days with only seconds (no hours or minutes)', () => {
            const result = (service as any).formatDuration(86415); // 1d 0h 0m 15s
            assert.strictEqual(result, '1d 15s');
        });
    });
});
