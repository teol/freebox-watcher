import { describe, it, before, after, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DailyChartService } from '../src/services/dailyChart.js';
import { HeartbeatService } from '../src/services/heartbeat.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

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

    it('should handle chart generation errors gracefully', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Mock getHeartbeatsInRange to throw error
        const originalMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => {
            throw new Error('Database connection failed');
        };

        try {
            // Should not throw - errors are logged but not re-thrown to prevent crashing scheduled tasks
            await service.generateAndSendChart();
            // If we reach here, the error was handled gracefully
            assert.ok(true, 'Error was handled gracefully without throwing');
        } finally {
            // Restore original method
            heartbeatService.getHeartbeatsInRange = originalMethod;
        }
    });

    it('should clean up temporary file even on Discord webhook failure', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Mock heartbeat data
        const mockHeartbeats = [
            {
                id: 1,
                status: 'up',
                timestamp: new Date('2025-12-06T10:00:00Z'),
                received_at: new Date('2025-12-06T10:00:00Z'),
                rate_down: 10000000,
                rate_up: 5000000,
                ipv4: null,
                ipv6: null,
                media_state: null,
                connection_type: null,
                bandwidth_down: null,
                bandwidth_up: null,
                bytes_down: null,
                bytes_up: null,
                metadata: null,
            },
        ];

        // Mock getHeartbeatsInRange
        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        // Mock fetch to simulate Discord API failure
        const originalFetch = global.fetch;
        global.fetch = async () => {
            return {
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => 'Invalid webhook URL',
            } as Response;
        };

        try {
            // Should not throw - errors are logged but not re-thrown to prevent crashing scheduled tasks
            await service.generateAndSendChart();

            // Verify that temp files were cleaned up even on error
            const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
            try {
                const files = await fs.readdir(tempDir);
                const chartFiles = files.filter((f) => f.startsWith('heartbeat-chart-'));
                assert.strictEqual(
                    chartFiles.length,
                    0,
                    'Temporary chart files should be cleaned up even on error'
                );
            } catch (err) {
                // If directory doesn't exist, that's fine - files were cleaned up
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw err;
                }
            }
        } finally {
            // Restore original methods
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    it('should successfully create and send chart with mocked Discord webhook', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        // Mock heartbeat data
        const mockHeartbeats = [
            {
                id: 1,
                status: 'up',
                timestamp: new Date('2025-12-06T10:00:00Z'),
                received_at: new Date('2025-12-06T10:00:00Z'),
                rate_down: 10000000, // 10 Mbps
                rate_up: 5000000, // 5 Mbps
                ipv4: null,
                ipv6: null,
                media_state: null,
                connection_type: null,
                bandwidth_down: null,
                bandwidth_up: null,
                bytes_down: null,
                bytes_up: null,
                metadata: null,
            },
            {
                id: 2,
                status: 'up',
                timestamp: new Date('2025-12-06T11:00:00Z'),
                received_at: new Date('2025-12-06T11:00:00Z'),
                rate_down: 15000000, // 15 Mbps
                rate_up: 7000000, // 7 Mbps
                ipv4: null,
                ipv6: null,
                media_state: null,
                connection_type: null,
                bandwidth_down: null,
                bandwidth_up: null,
                bytes_down: null,
                bytes_up: null,
                metadata: null,
            },
        ];

        // Mock getHeartbeatsInRange
        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        // Mock fetch to simulate successful Discord response
        const originalFetch = global.fetch;
        let fetchCalled = false;
        global.fetch = async () => {
            fetchCalled = true;
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => 'success',
            } as Response;
        };

        try {
            await service.generateAndSendChart();

            // Verify fetch was called
            assert.strictEqual(fetchCalled, true, 'Discord webhook should have been called');

            // Verify that temp files were cleaned up
            const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
            try {
                const files = await fs.readdir(tempDir);
                const chartFiles = files.filter((f) => f.startsWith('heartbeat-chart-'));
                assert.strictEqual(
                    chartFiles.length,
                    0,
                    'Temporary chart files should be cleaned up'
                );
            } catch (err) {
                // If directory doesn't exist, that's fine - files were cleaned up
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw err;
                }
            }
        } finally {
            // Restore original methods
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    describe('parseCronInterval', () => {
        it('should parse daily CRON pattern (0 5 * * *) as 24 hours', () => {
            const result = DailyChartService.parseCronInterval('0 5 * * *');
            assert.strictEqual(result, 24);
        });

        it('should parse hourly interval pattern (0 */4 * * *) as 4 hours', () => {
            const result = DailyChartService.parseCronInterval('0 */4 * * *');
            assert.strictEqual(result, 4);
        });

        it('should parse hourly interval pattern (0 */6 * * *) as 6 hours', () => {
            const result = DailyChartService.parseCronInterval('0 */6 * * *');
            assert.strictEqual(result, 6);
        });

        it('should parse hourly interval pattern (0 */2 * * *) as 2 hours', () => {
            const result = DailyChartService.parseCronInterval('0 */2 * * *');
            assert.strictEqual(result, 2);
        });

        it('should parse every hour pattern (0 * * * *) as 1 hour', () => {
            const result = DailyChartService.parseCronInterval('0 * * * *');
            assert.strictEqual(result, 1);
        });

        it('should parse any specific hour as 24 hours (daily)', () => {
            const result = DailyChartService.parseCronInterval('0 10 * * *');
            assert.strictEqual(result, 24);
        });

        it('should default to 24 hours for invalid CRON expression', () => {
            const result = DailyChartService.parseCronInterval('invalid');
            assert.strictEqual(result, 24);
        });

        it('should default to 24 hours for empty CRON expression', () => {
            const result = DailyChartService.parseCronInterval('');
            assert.strictEqual(result, 24);
        });

        it('should default to 24 hours for incomplete CRON expression', () => {
            const result = DailyChartService.parseCronInterval('0 5');
            assert.strictEqual(result, 24);
        });

        it('should default to 24 hours for unsupported CRON pattern', () => {
            // Weekly pattern
            const result = DailyChartService.parseCronInterval('0 5 * * 1');
            assert.strictEqual(result, 24);
        });

        it('should handle CRON expression with extra whitespace', () => {
            const result = DailyChartService.parseCronInterval('  0   */3   *   *   *  ');
            assert.strictEqual(result, 3);
        });
    });
});
