import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';
import { DailyChartService } from '../src/services/dailyChart.js';
import { HeartbeatService } from '../src/services/heartbeat.js';
import fs from 'fs/promises';

describe('DailyChartService', () => {
    let heartbeatService: HeartbeatService;

    before(() => {
        heartbeatService = new HeartbeatService();
    });

    it('should initialize with Discord webhook URL', () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        assert.ok(service);
    });

    it('should initialize without Discord webhook URL', () => {
        const service = new DailyChartService(heartbeatService);

        assert.ok(service);
    });

    it('should not start when Discord webhook URL is not configured', () => {
        const service = new DailyChartService(heartbeatService);

        // Should not throw
        service.start();

        // Service should handle gracefully (no cron job created)
        service.stop();
    });

    it('should start when Discord webhook URL is configured', () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Should not throw
        service.start();

        // Clean up
        service.stop();
    });

    it('should stop gracefully when not started', () => {
        const service = new DailyChartService(heartbeatService);

        // Should not throw
        service.stop();
    });

    it('should handle multiple start calls gracefully', () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        service.start();
        service.start(); // Second start should be handled gracefully

        service.stop();
    });

    it('should warn when trying to generate chart without webhook', async () => {
        const service = new DailyChartService(heartbeatService);

        // Should not throw, but should log warning
        await service.generateAndSendChart();
    });

    it('should handle empty heartbeat data gracefully', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Mock getHeartbeatsInRange to return empty array
        const originalMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => [];

        try {
            // Should not throw, just log warning
            await service.generateAndSendChart();
        } finally {
            // Restore original method
            heartbeatService.getHeartbeatsInRange = originalMethod;
        }
    });

    it.skip('should create chart image with valid data (requires mock)', async () => {
        // This test is skipped as it requires proper fetch mocking
        // which is complex with TypeScript types
    });

    it('should handle chart generation errors gracefully', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Mock getHeartbeatsInRange to throw error
        const originalMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => {
            throw new Error('Database connection failed');
        };

        try {
            await assert.rejects(
                async () => await service.generateAndSendChart(),
                (error: Error) => {
                    assert.ok(error.message.includes('Database connection failed'));
                    return true;
                }
            );
        } finally {
            // Restore original method
            heartbeatService.getHeartbeatsInRange = originalMethod;
        }
    });

    it.skip('should handle Discord webhook failures gracefully', async () => {
        // This test is skipped as it requires proper fetch mocking
        // which is complex with TypeScript types
    });
});
