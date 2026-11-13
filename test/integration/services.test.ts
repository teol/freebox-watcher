import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import { db } from '../../src/db/config.js';
import { HeartbeatService, type HeartbeatInput } from '../../src/services/heartbeat.js';
import { DowntimeService } from '../../src/services/downtime.js';
import { HEALTH_SAMPLE_COLUMNS } from '../../src/services/healthChecks.js';
import type { DevicesTable } from '../../src/types/database.js';
import { setupDatabase, resetDatabase, teardownDatabase, insertHeartbeats } from './setup.js';

before(setupDatabase);
beforeEach(resetDatabase);
after(teardownDatabase);

const FULL_PAYLOAD: HeartbeatInput = {
    connection_state: 'up',
    timestamp: '2026-11-13T10:00:00.000Z',
    ipv4: '82.67.197.112',
    ipv6: '2a01:e0a:de7:a4a0::1',
    media_state: 'ftth',
    connection_type: 'ethernet',
    bandwidth_down: 8_000_000_000,
    bandwidth_up: 700_000_000,
    rate_down: 4734,
    rate_up: 3461,
    bytes_down: 1_142_257_499_691,
    bytes_up: 149_819_666_255,
    connected_devices_total: 4,
    connected_devices_wifi: 3,
    sfp_pwr_rx_dbm: -19.17,
    sfp_pwr_tx_dbm: 2.69,
    temp_cpu: 62,
    temp_switch: 55,
    fan_rpm: 1800,
    uptime: 1_868_123,
    disk_temp: 41,
    disk_used_bytes: 120_000_000_000,
    disk_free_bytes: 880_000_000_000,
    disk_total_bytes: 1_000_000_000_000,
    disk_read_errors: 0,
    disk_write_errors: 2,
    active_devices: [{ mac: 'AA:BB:CC:11:22:33', name: 'Phone', type: 'smartphone' }],
    firmware_version: '4.9.1',
};

describe('HeartbeatService (database)', () => {
    const service = new HeartbeatService();

    it('should store and read back every heartbeat field', async () => {
        const { id } = await service.recordHeartbeat(FULL_PAYLOAD);
        const heartbeat = await service.getLastHeartbeat();

        assert.ok(heartbeat);
        assert.strictEqual(heartbeat.id, id);
        assert.strictEqual(heartbeat.status, 'up');
        assert.strictEqual(heartbeat.timestamp.toISOString(), FULL_PAYLOAD.timestamp);
        assert.ok(heartbeat.received_at instanceof Date);
        assert.strictEqual(heartbeat.ipv4, FULL_PAYLOAD.ipv4);
        assert.strictEqual(heartbeat.ipv6, FULL_PAYLOAD.ipv6);
        assert.strictEqual(heartbeat.media_state, 'ftth');
        // BIGINT columns must come back as numbers, without precision loss
        assert.strictEqual(heartbeat.bandwidth_down, FULL_PAYLOAD.bandwidth_down);
        assert.strictEqual(heartbeat.bytes_down, FULL_PAYLOAD.bytes_down);
        assert.strictEqual(heartbeat.uptime, FULL_PAYLOAD.uptime);
        assert.strictEqual(heartbeat.disk_total_bytes, FULL_PAYLOAD.disk_total_bytes);
        assert.strictEqual(heartbeat.disk_write_errors, 2);
        // FLOAT columns are single precision
        assert.ok(Math.abs((heartbeat.sfp_pwr_rx_dbm ?? 0) - -19.17) < 0.01);
        assert.ok(Math.abs((heartbeat.sfp_pwr_tx_dbm ?? 0) - 2.69) < 0.01);
        assert.deepStrictEqual(heartbeat.active_devices, FULL_PAYLOAD.active_devices);
        // Unknown fields are kept in metadata
        assert.deepStrictEqual(heartbeat.metadata, { firmware_version: '4.9.1' });
    });

    it('should store a minimal heartbeat with null optional fields', async () => {
        await service.recordHeartbeat({
            connection_state: 'up',
            timestamp: '2026-11-13T10:00:00.000Z',
        });
        const heartbeat = await service.getLastHeartbeat();

        assert.ok(heartbeat);
        assert.strictEqual(heartbeat.sfp_pwr_rx_dbm, null);
        assert.strictEqual(heartbeat.active_devices, null);
        assert.strictEqual(heartbeat.metadata, null);
    });

    it('should register new devices once and keep the registry up to date', async () => {
        const first = await service.recordHeartbeat({
            connection_state: 'up',
            timestamp: '2026-11-13T10:00:00.000Z',
            active_devices: [
                { mac: 'AA:BB:CC:11:22:33', name: 'Phone', type: 'smartphone' },
                { mac: 'AA:BB:CC:11:22:33', name: 'Phone', type: 'smartphone' },
                { mac: '', name: 'No MAC', type: 'other' },
            ],
        });
        assert.deepStrictEqual(
            first.newDevices.map((d) => d.mac),
            ['AA:BB:CC:11:22:33']
        );

        const second = await service.recordHeartbeat({
            connection_state: 'up',
            timestamp: '2026-11-13T10:05:00.000Z',
            active_devices: [
                { mac: 'AA:BB:CC:11:22:33', name: 'Renamed phone', type: 'smartphone' },
                { mac: 'DD:EE:FF:44:55:66', name: 'Laptop', type: 'laptop' },
            ],
        });
        assert.deepStrictEqual(
            second.newDevices.map((d) => d.mac),
            ['DD:EE:FF:44:55:66']
        );

        const devices = await db<DevicesTable>('devices').orderBy('mac');
        assert.strictEqual(devices.length, 2);
        assert.strictEqual(devices[0].name, 'Renamed phone');
        assert.strictEqual(devices[0].first_seen_at.toISOString(), '2026-11-13T10:00:00.000Z');
        assert.strictEqual(devices[0].last_seen_at.toISOString(), '2026-11-13T10:05:00.000Z');
    });

    it('should not register any device when one insert of the transaction fails', async () => {
        await assert.rejects(
            service.recordHeartbeat({
                connection_state: 'up',
                timestamp: '2026-11-13T10:00:00.000Z',
                active_devices: [{ mac: 'AA:BB:CC:11:22:33', name: 'x'.repeat(300), type: 'tv' }],
            })
        );

        assert.strictEqual(await service.getLastHeartbeat(), null);
        assert.strictEqual((await db('devices')).length, 0);
    });

    it('should page heartbeats in a range without the sensitive columns', async () => {
        for (let minute = 0; minute < 5; minute++) {
            await service.recordHeartbeat({
                ...FULL_PAYLOAD,
                timestamp: new Date(Date.UTC(2026, 10, 13, 10, minute)).toISOString(),
            });
        }

        const page = await service.getHeartbeatsPage(
            new Date('2026-11-13T10:01:00.000Z'),
            new Date('2026-11-13T10:04:00.000Z'),
            2,
            1
        );

        assert.deepStrictEqual(
            page.map((h) => h.timestamp.toISOString()),
            ['2026-11-13T10:02:00.000Z', '2026-11-13T10:03:00.000Z']
        );
        for (const column of ['ipv4', 'ipv6', 'active_devices', 'metadata']) {
            assert.ok(!(column in page[0]), `${column} must not be selected`);
        }

        const byId = await service.getHeartbeatById(page[0].id);
        assert.strictEqual(byId?.id, page[0].id);
        assert.ok(byId && !('ipv4' in byId));
        assert.strictEqual(await service.getHeartbeatById(999_999), null);
    });

    it('should return the health samples of a range ordered by timestamp', async () => {
        await insertHeartbeats([
            { status: 'up', timestamp: new Date('2026-11-13T10:02:00.000Z'), sfp_pwr_rx_dbm: -20 },
            { status: 'up', timestamp: new Date('2026-11-13T10:00:00.000Z'), sfp_pwr_rx_dbm: -18 },
            { status: 'up', timestamp: new Date('2026-11-13T09:00:00.000Z'), sfp_pwr_rx_dbm: -10 },
        ]);

        const samples = await service.getHealthSamples(
            new Date('2026-11-13T09:30:00.000Z'),
            new Date('2026-11-13T11:00:00.000Z')
        );

        assert.deepStrictEqual(
            samples.map((s) => s.sfp_pwr_rx_dbm),
            [-18, -20]
        );
        assert.deepStrictEqual(Object.keys(samples[0]).sort(), [...HEALTH_SAMPLE_COLUMNS].sort());
    });

    it('should delete heartbeats older than the retention period', async () => {
        const old = new Date(Date.now() - 40 * 86400 * 1000);
        await insertHeartbeats([
            { status: 'up', timestamp: old },
            { status: 'up', timestamp: new Date() },
        ]);

        assert.strictEqual(await service.cleanupOldHeartbeats(30), 1);
        assert.strictEqual((await db('heartbeats')).length, 1);
    });
});

describe('DowntimeService (database)', () => {
    const service = new DowntimeService();

    it('should create, find and end a downtime event', async () => {
        const startedAt = new Date('2026-11-13T10:00:00.000Z');
        const id = await service.createDowntimeEvent(startedAt, 'test');

        const active = await service.getActiveDowntimeEvent();
        assert.strictEqual(active?.id, id);
        assert.strictEqual(active?.started_at.toISOString(), startedAt.toISOString());
        assert.strictEqual(Boolean(active?.is_active), true);

        await service.endDowntimeEvent(id, new Date('2026-11-13T10:12:30.000Z'));

        assert.strictEqual(await service.getActiveDowntimeEvent(), null);
        const [event] = await service.getAllDowntimeEvents();
        assert.strictEqual(event.duration, 750);
        assert.strictEqual(Boolean(event.is_active), false);
        assert.strictEqual(event.ended_at?.toISOString(), '2026-11-13T10:12:30.000Z');
    });

    it('should fail to end an unknown downtime event', async () => {
        await assert.rejects(
            service.endDowntimeEvent(404, new Date()),
            /Downtime event with ID 404 not found/
        );
    });

    it('should page the downtime events overlapping a range, including active ones', async () => {
        const before = await service.createDowntimeEvent(new Date('2026-11-12T08:00:00.000Z'));
        await service.endDowntimeEvent(before, new Date('2026-11-12T08:10:00.000Z'));
        const overlapping = await service.createDowntimeEvent(new Date('2026-11-13T09:50:00.000Z'));
        await service.endDowntimeEvent(overlapping, new Date('2026-11-13T10:05:00.000Z'));
        const active = await service.createDowntimeEvent(new Date('2026-11-13T11:00:00.000Z'));

        const page = await service.getDowntimeEventsPage(
            new Date('2026-11-13T10:00:00.000Z'),
            new Date('2026-11-13T12:00:00.000Z'),
            10,
            0
        );

        assert.deepStrictEqual(
            page.map((e) => e.id),
            [active, overlapping]
        );
        assert.strictEqual(
            await service.getTotalDowntime(
                new Date('2026-11-12T00:00:00.000Z'),
                new Date('2026-11-12T23:59:59.000Z')
            ),
            600
        );
    });
});
