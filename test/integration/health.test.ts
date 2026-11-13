import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { HeartbeatService } from '../../src/services/heartbeat.js';
import { NotificationService } from '../../src/services/notification.js';
import {
    HealthMonitor,
    loadHealthMonitorConfig,
    type HealthReport,
} from '../../src/services/healthMonitor.js';
import type { HeartbeatsInsert } from '../../src/types/database.js';
import { setupDatabase, resetDatabase, teardownDatabase, insertHeartbeats } from './setup.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const INTERVAL_MS = 15 * 60000;

/**
 * One heartbeat per minute over the last two hours, the last 15 minutes using `recent` values
 */
function heartbeats(recent: Partial<HeartbeatsInsert>): HeartbeatsInsert[] {
    const rows: HeartbeatsInsert[] = [];
    for (let minute = 120; minute > 0; minute--) {
        const timestamp = new Date(NOW.getTime() - minute * 60000);
        rows.push({
            status: 'up',
            timestamp,
            ipv4: '82.67.197.112',
            media_state: 'ftth',
            bandwidth_down: 8_000_000_000,
            bandwidth_up: 700_000_000,
            sfp_pwr_rx_dbm: -18,
            sfp_pwr_tx_dbm: 3,
            temp_cpu: 65,
            temp_switch: 55,
            fan_rpm: 1800,
            uptime: 100_000 + (120 - minute) * 60,
            disk_temp: 40,
            disk_used_bytes: 500_000_000_000,
            disk_total_bytes: 1_000_000_000_000,
            disk_read_errors: 0,
            disk_write_errors: 0,
            ...(minute <= 15 ? recent : {}),
        });
    }
    return rows;
}

describe('HealthMonitor (database)', () => {
    let fastify: FastifyInstance;
    let monitor: HealthMonitor;
    let reports: HealthReport[];

    before(async () => {
        await setupDatabase();
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(async () => {
        await resetDatabase();
        reports = [];
        const notificationService = new NotificationService(fastify.log);
        notificationService.isEnabled = () => true;
        notificationService.sendHealthAlert = async (report) => {
            reports.push(report);
        };
        // Default configuration: every alert enabled with the default thresholds
        monitor = new HealthMonitor(fastify.log, notificationService, new HeartbeatService(), {
            ...loadHealthMonitorConfig(),
            checkIntervalMs: INTERVAL_MS,
        });
    });

    after(async () => {
        await fastify.close();
        await teardownDatabase();
    });

    it('should notify nothing for a healthy Freebox', async () => {
        await insertHeartbeats(heartbeats({}));

        assert.strictEqual(await monitor.check(NOW), null);
        assert.strictEqual(reports.length, 0);
    });

    it('should detect degradations and events from the stored heartbeats', async () => {
        await insertHeartbeats(
            heartbeats({
                sfp_pwr_rx_dbm: -27.5,
                media_state: 'backup_4g',
                disk_used_bytes: 960_000_000_000,
                ipv4: '82.67.1.1',
                disk_write_errors: 2,
            })
        );

        const report = await monitor.check(NOW);

        assert.deepStrictEqual(
            report?.degraded.map((r) => [r.check, r.severity]),
            [
                ['fiber_rx', 'critical'],
                ['media', 'warning'],
                ['disk_space', 'critical'],
            ]
        );
        assert.deepStrictEqual(
            report?.events.map((e) => e.message),
            [
                'Public IPv4 changed from 82.67.197.112 to 82.67.1.1',
                'Disk errors increased: +2 write (total 2)',
            ]
        );
        assert.strictEqual(reports.length, 1);
    });
});
