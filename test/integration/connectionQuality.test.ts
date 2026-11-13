import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { HeartbeatService } from '../../src/services/heartbeat.js';
import { NotificationService } from '../../src/services/notification.js';
import {
    ConnectionQualityMonitor,
    type QualityReport,
} from '../../src/services/connectionQualityMonitor.js';
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
            media_state: 'ftth',
            bandwidth_down: 8_000_000_000,
            bandwidth_up: 700_000_000,
            sfp_pwr_rx_dbm: -18,
            sfp_pwr_tx_dbm: 3,
            uptime: 100_000 + (120 - minute) * 60,
            ...(minute <= 15 ? recent : {}),
        });
    }
    return rows;
}

describe('ConnectionQualityMonitor (database)', () => {
    let fastify: FastifyInstance;
    let monitor: ConnectionQualityMonitor;
    let reports: QualityReport[];

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
        notificationService.sendConnectionQualityAlert = async (report) => {
            reports.push(report);
        };
        monitor = new ConnectionQualityMonitor(
            fastify.log,
            notificationService,
            new HeartbeatService(),
            {
                enabled: true,
                checkIntervalMs: INTERVAL_MS,
                baselineHours: 24,
                sfpRxWarningDbm: -25,
                sfpRxCriticalDbm: -27,
                sfpDropDb: 2,
                bandwidthDropPercent: 20,
            }
        );
    });

    after(async () => {
        await fastify.close();
        await teardownDatabase();
    });

    it('should notify nothing for a healthy connection', async () => {
        await insertHeartbeats(heartbeats({}));

        assert.strictEqual(await monitor.check(NOW), null);
        assert.strictEqual(reports.length, 0);
    });

    it('should detect a fiber signal degradation and a switch to the 4G backup', async () => {
        await insertHeartbeats(heartbeats({ sfp_pwr_rx_dbm: -27.5, media_state: 'backup_4g' }));

        const report = await monitor.check(NOW);

        assert.deepStrictEqual(
            report?.degraded.map((r) => [r.check, r.severity]),
            [
                ['sfp_rx', 'critical'],
                ['media_state', 'warning'],
            ]
        );
        assert.strictEqual(reports.length, 1);
    });
});
