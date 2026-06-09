import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert';
import { BaseChartService } from '../src/services/baseChart.js';
import { DevicesChartService } from '../src/services/devicesChart.js';
import { HeartbeatService } from '../src/services/heartbeat.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/** Minimal HeartbeatRecord shape needed by the devices chart */
interface MockHeartbeat {
    id: number;
    status: string;
    timestamp: Date;
    received_at: Date;
    rate_down: number | null;
    rate_up: number | null;
    ipv4: null;
    ipv6: null;
    media_state: null;
    connection_type: null;
    bandwidth_down: null;
    bandwidth_up: null;
    bytes_down: null;
    bytes_up: null;
    connected_devices_total: number | null;
    connected_devices_wifi: number | null;
    sfp_pwr_rx_dbm: null;
    sfp_pwr_tx_dbm: null;
    temp_cpu: null;
    temp_switch: null;
    fan_rpm: null;
    uptime: null;
    active_devices: null;
    metadata: null;
    disk_temp: null;
    disk_used_bytes: null;
    disk_free_bytes: null;
    disk_total_bytes: null;
    disk_read_errors: null;
    disk_write_errors: null;
}

function makeMockHeartbeat(
    id: number,
    timestamp: Date,
    total: number | null,
    wifi: number | null
): MockHeartbeat {
    return {
        id,
        status: 'up',
        timestamp,
        received_at: timestamp,
        rate_down: null,
        rate_up: null,
        ipv4: null,
        ipv6: null,
        media_state: null,
        connection_type: null,
        bandwidth_down: null,
        bandwidth_up: null,
        bytes_down: null,
        bytes_up: null,
        connected_devices_total: total,
        connected_devices_wifi: wifi,
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
    };
}

describe('DevicesChartService', () => {
    let heartbeatService: HeartbeatService;

    before(() => {
        heartbeatService = new HeartbeatService();
    });

    afterEach(() => {
        delete process.env.DEVICES_CHART_ENABLED;
    });

    it('should initialize with Discord webhook URL and enabled flag', () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );
        assert.ok(service);
        assert.ok(service instanceof BaseChartService);
    });

    it('should initialize without webhook URL', () => {
        const service = new DevicesChartService(heartbeatService);
        assert.ok(service);
        assert.ok(service instanceof BaseChartService);
    });

    it('should not start when disabled', () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            false
        );
        service.start();
        service.stop();
    });

    it('should not start when Discord webhook URL is not configured (even if enabled)', () => {
        const service = new DevicesChartService(heartbeatService, undefined, undefined, true);
        service.start();
        service.stop();
    });

    it('should start when enabled and webhook is configured', () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );
        service.start();
        service.stop();
    });

    it('should stop gracefully when not started', () => {
        const service = new DevicesChartService(heartbeatService);
        service.stop(); // should not throw
    });

    it('should handle multiple start calls gracefully', () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );
        service.start();
        service.start(); // second start should warn but not throw
        service.stop();
    });

    it('should not generate chart when webhook is missing', async () => {
        const service = new DevicesChartService(heartbeatService, undefined, undefined, true);
        await service.generateAndSendChart(); // should not throw
    });

    it('should warn when no heartbeat data is available', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        const originalMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => [];

        try {
            await service.generateAndSendChart(); // should not throw
        } finally {
            heartbeatService.getHeartbeatsInRange = originalMethod;
        }
    });

    it('should handle chart generation errors gracefully', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        const originalMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => {
            throw new Error('Database connection failed');
        };

        try {
            await service.generateAndSendChart(); // should not throw
            assert.ok(true, 'Error was handled gracefully');
        } finally {
            heartbeatService.getHeartbeatsInRange = originalMethod;
        }
    });

    it('should clean up temporary file even on Discord webhook failure', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        const mockHeartbeats = [
            makeMockHeartbeat(1, new Date('2025-12-06T10:00:00Z'), 5, 3),
            makeMockHeartbeat(2, new Date('2025-12-06T11:00:00Z'), 6, 4),
        ];

        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        const originalFetch = global.fetch;
        global.fetch = async () =>
            ({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
                text: async () => 'Invalid webhook',
            }) as Response;

        try {
            await service.generateAndSendChart();

            const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
            try {
                const files = await fs.readdir(tempDir);
                const chartFiles = files.filter((f) => f.startsWith('devices-chart-'));
                assert.strictEqual(
                    chartFiles.length,
                    0,
                    'Temporary chart files should be cleaned up'
                );
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            }
        } finally {
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    it('should successfully create and send devices chart to Discord', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        const mockHeartbeats = [
            makeMockHeartbeat(1, new Date('2025-12-06T10:00:00Z'), 4, 2),
            makeMockHeartbeat(2, new Date('2025-12-06T10:30:00Z'), 5, 3),
            makeMockHeartbeat(3, new Date('2025-12-06T11:00:00Z'), 7, 5),
        ];

        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        const originalFetch = global.fetch;
        let fetchCalled = false;
        let fetchBody: FormData | undefined;
        global.fetch = async (_url, init) => {
            fetchCalled = true;
            fetchBody = init?.body as FormData;
            return {
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => 'success',
            } as Response;
        };

        try {
            await service.generateAndSendChart();

            assert.strictEqual(fetchCalled, true, 'Discord webhook should have been called');

            // Verify temp files were cleaned up
            const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
            try {
                const files = await fs.readdir(tempDir);
                const chartFiles = files.filter((f) => f.startsWith('devices-chart-'));
                assert.strictEqual(
                    chartFiles.length,
                    0,
                    'Temporary chart files should be cleaned up'
                );
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
            }
        } finally {
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    it('should handle null device counts gracefully in chart data', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        // Some heartbeats have null device counts (e.g. LAN API unavailable)
        const mockHeartbeats = [
            makeMockHeartbeat(1, new Date('2025-12-06T10:00:00Z'), null, null),
            makeMockHeartbeat(2, new Date('2025-12-06T10:30:00Z'), 5, 3),
            makeMockHeartbeat(3, new Date('2025-12-06T11:00:00Z'), null, null),
        ];

        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

        const originalFetch = global.fetch;
        global.fetch = async () =>
            ({
                ok: true,
                status: 200,
                statusText: 'OK',
                text: async () => 'success',
            }) as Response;

        try {
            await assert.doesNotReject(async () => {
                await service.generateAndSendChart();
            });
        } finally {
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });

    it('should include "Connected Devices" in Discord message content', async () => {
        const service = new DevicesChartService(
            heartbeatService,
            'https://discord.com/api/webhooks/123/test',
            undefined,
            true
        );

        const mockHeartbeats = [makeMockHeartbeat(1, new Date('2025-12-06T10:00:00Z'), 3, 2)];

        const originalHeartbeatMethod = heartbeatService.getHeartbeatsInRange;
        heartbeatService.getHeartbeatsInRange = async () => mockHeartbeats;

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
            const payload = JSON.parse(capturedPayloadJson) as { content: string };
            assert.match(payload.content, /Connected Devices/);
        } finally {
            heartbeatService.getHeartbeatsInRange = originalHeartbeatMethod;
            global.fetch = originalFetch;
        }
    });
});
