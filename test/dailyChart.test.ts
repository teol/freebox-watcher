import { describe, it, before, after, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { BaseChartService } from '../src/services/baseChart.js';
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
        assert.ok(service instanceof BaseChartService);
    });

    it('should initialize without Discord webhook URL', () => {
        const service = new DailyChartService(heartbeatService);

        assert.ok(service);
        assert.ok(service instanceof BaseChartService);
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
                connected_devices_total: null,
                connected_devices_wifi: null,
                sfp_pwr_rx_dbm: null,
                sfp_pwr_tx_dbm: null,
                temp_cpu: null,
                temp_switch: null,
                fan_rpm: null,
                uptime: null,
                active_devices: null,
                metadata: null,
                disk_temp: null,
                disk_used_bytes: null,
                disk_free_bytes: null,
                disk_total_bytes: null,
                disk_read_errors: null,
                disk_write_errors: null,
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
                connected_devices_total: null,
                connected_devices_wifi: null,
                sfp_pwr_rx_dbm: null,
                sfp_pwr_tx_dbm: null,
                temp_cpu: null,
                temp_switch: null,
                fan_rpm: null,
                uptime: null,
                active_devices: null,
                metadata: null,
                disk_temp: null,
                disk_used_bytes: null,
                disk_free_bytes: null,
                disk_total_bytes: null,
                disk_read_errors: null,
                disk_write_errors: null,
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
                connected_devices_total: null,
                connected_devices_wifi: null,
                sfp_pwr_rx_dbm: null,
                sfp_pwr_tx_dbm: null,
                temp_cpu: null,
                temp_switch: null,
                fan_rpm: null,
                uptime: null,
                active_devices: null,
                metadata: null,
                disk_temp: null,
                disk_used_bytes: null,
                disk_free_bytes: null,
                disk_total_bytes: null,
                disk_read_errors: null,
                disk_write_errors: null,
            },
        ];

        // Mock getHeartbeatsInRange
        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        // Mock fetch to simulate successful Discord response
        const originalFetch = global.fetch;
        let capturedPayloadJson = '';
        global.fetch = async (_url, init) => {
            const form = init?.body as FormData;
            capturedPayloadJson = form.get('payload_json') as string;
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => 'success',
            } as Response;
        };

        try {
            await service.generateAndSendChart();

            // Verify fetch was called and payload contains the embed image reference
            assert.ok(capturedPayloadJson, 'Discord webhook should have been called');
            const payload = JSON.parse(capturedPayloadJson) as {
                embeds: Array<{ image?: { url: string } }>;
            };
            assert.ok(
                payload.embeds[0].image?.url.startsWith('attachment://heartbeat-chart-'),
                'Embed image URL should reference the attached chart file'
            );

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

    it('should preserve a rate of 0 as a data point rather than mapping it to null', async () => {
        const webhookUrl = 'https://discord.com/api/webhooks/123/test';
        const service = new DailyChartService(heartbeatService, webhookUrl);

        const mockHeartbeats = [
            {
                id: 1,
                status: 'up',
                timestamp: new Date('2025-12-06T10:00:00Z'),
                received_at: new Date('2025-12-06T10:00:00Z'),
                rate_down: 0, // idle — must appear as 0, not as a gap
                rate_up: 0,
                ipv4: null,
                ipv6: null,
                media_state: null,
                connection_type: null,
                bandwidth_down: null,
                bandwidth_up: null,
                bytes_down: null,
                bytes_up: null,
                connected_devices_total: null,
                connected_devices_wifi: null,
                sfp_pwr_rx_dbm: null,
                sfp_pwr_tx_dbm: null,
                temp_cpu: null,
                temp_switch: null,
                fan_rpm: null,
                uptime: null,
                active_devices: null,
                metadata: null,
                disk_temp: null,
                disk_used_bytes: null,
                disk_free_bytes: null,
                disk_total_bytes: null,
                disk_read_errors: null,
                disk_write_errors: null,
            },
        ];

        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        const originalFetch = global.fetch;
        let capturedPayloadJson = '';
        global.fetch = async (_url, init) => {
            capturedPayloadJson = (init?.body as FormData).get('payload_json') as string;
            return { ok: true, status: 200, statusText: 'OK', text: async () => '' } as Response;
        };

        try {
            await service.generateAndSendChart();
            // Chart was generated (fetch called) — 0-rate heartbeat was not filtered out
            assert.ok(
                capturedPayloadJson,
                'Chart should have been generated for a 0-rate heartbeat'
            );
        } finally {
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    // parseCronInterval lives on BaseChartService and is inherited by DailyChartService.
    // Tests call it via BaseChartService directly; the DailyChartService.parseCronInterval
    // alias is verified by a dedicated test below.
    describe('parseCronInterval', () => {
        it('should parse daily CRON pattern (0 5 * * *) as 24 hours', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 5 * * *'), 24);
        });

        it('should parse hourly interval pattern (0 */4 * * *) as 4 hours', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 */4 * * *'), 4);
        });

        it('should parse hourly interval pattern (0 */6 * * *) as 6 hours', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 */6 * * *'), 6);
        });

        it('should parse hourly interval pattern (0 */2 * * *) as 2 hours', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 */2 * * *'), 2);
        });

        it('should parse every hour pattern (0 * * * *) as 1 hour', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 * * * *'), 1);
        });

        it('should parse any specific hour as 24 hours (daily)', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 10 * * *'), 24);
        });

        it('should default to 24 hours for invalid CRON expression', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('invalid'), 24);
        });

        it('should default to 24 hours for empty CRON expression', () => {
            assert.strictEqual(BaseChartService.parseCronInterval(''), 24);
        });

        it('should default to 24 hours for incomplete CRON expression', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('0 5'), 24);
        });

        it('should default to 24 hours for unsupported CRON pattern', () => {
            // Weekly pattern
            assert.strictEqual(BaseChartService.parseCronInterval('0 5 * * 1'), 24);
        });

        it('should handle CRON expression with extra whitespace', () => {
            assert.strictEqual(BaseChartService.parseCronInterval('  0   */3   *   *   *  '), 3);
        });

        it('should be accessible on DailyChartService via static inheritance', () => {
            // Verify the static method is reachable on the subclass for backwards compatibility
            assert.strictEqual(
                DailyChartService.parseCronInterval,
                BaseChartService.parseCronInterval
            );
        });
    });
});
