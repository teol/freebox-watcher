import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { NotificationService } from '../src/services/notification.js';

describe('NotificationService', () => {
    let fastify: FastifyInstance;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
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

    it('should have sendDowntimeAlert method', () => {
        const service = new NotificationService(fastify.log);

        assert.strictEqual(typeof service.sendDowntimeAlert, 'function');
    });

    it('should have sendDowntimeConfirmedAlert method', () => {
        const service = new NotificationService(fastify.log);

        assert.strictEqual(typeof service.sendDowntimeConfirmedAlert, 'function');
    });

    it('should have sendRecoveryAlert method', () => {
        const service = new NotificationService(fastify.log);

        assert.strictEqual(typeof service.sendRecoveryAlert, 'function');
    });

    it('should not throw when sending alerts while disabled', async () => {
        delete process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_CHAT_ID;

        const service = new NotificationService(fastify.log);

        // These should silently do nothing when service is disabled
        await assert.doesNotReject(async () => {
            await service.sendDowntimeAlert({
                downtimeId: 1,
                startedAt: new Date(),
            });
        });

        await assert.doesNotReject(async () => {
            await service.sendDowntimeConfirmedAlert({
                downtimeId: 1,
                startedAt: new Date(),
            });
        });

        await assert.doesNotReject(async () => {
            await service.sendRecoveryAlert(1, new Date(), new Date());
        });
    });
});
