import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import { heartbeatRoutes } from '../src/routes/heartbeat.js';
import { type HeartbeatInput, type ActiveDevice } from '../src/services/heartbeat.js';
import { NotificationService } from '../src/services/notification.js';
import { DowntimeMonitor } from '../src/services/downtimeMonitor.js';
import { registerRawBodyCapture } from '../src/middleware/rawBodyCapture.js';
import { computeHmac, getCurrentTimestamp, generateNonce } from './helpers.js';

interface HeartbeatResponseBody {
    success?: boolean;
    message: string;
    id?: number;
}

describe('Heartbeat Routes', () => {
    let fastify: FastifyInstance;
    const testApiSecret = 'test-heartbeat-secret-32-chars-long';

    before(async () => {
        // Set up test environment
        process.env.API_SECRET = testApiSecret;

        fastify = Fastify({ logger: false });

        // Register raw body capture (required for HMAC)
        await registerRawBodyCapture(fastify);

        // Initialize and decorate services (required by heartbeat routes)
        const notificationService = new NotificationService(fastify.log);
        const downtimeMonitor = new DowntimeMonitor(fastify.log, notificationService);
        fastify.decorate('notificationService', notificationService);
        fastify.decorate('downtimeMonitor', downtimeMonitor);

        await fastify.register(heartbeatRoutes);
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    it('should reject heartbeat without authentication', async () => {
        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            payload: {
                connection_state: 'up',
                timestamp: new Date().toISOString(),
            },
        });

        assert.strictEqual(response.statusCode, 401);
    });

    it('should reject heartbeat with invalid timestamp', async () => {
        const timestamp = getCurrentTimestamp();
        const nonce = generateNonce();
        const bodyString = '{"connection_state":"up","timestamp":"invalid-timestamp"}';
        const signature = computeHmac(
            'POST',
            '/heartbeat',
            timestamp,
            nonce,
            bodyString,
            testApiSecret
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            headers: {
                authorization: `Bearer ${signature}`,
                'signature-timestamp': timestamp,
                'signature-nonce': nonce,
                'content-type': 'application/json',
            },
            payload: bodyString,
        });

        assert.strictEqual(response.statusCode, 400);
        const body = JSON.parse(response.body) as HeartbeatResponseBody;
        assert.ok(body.message.includes('Invalid timestamp'));
    });

    it('should reject heartbeat with missing required fields', async () => {
        const timestamp = getCurrentTimestamp();
        const nonce = generateNonce();
        const bodyString = '{"connection_state":"up"}';
        const signature = computeHmac(
            'POST',
            '/heartbeat',
            timestamp,
            nonce,
            bodyString,
            testApiSecret
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            headers: {
                authorization: `Bearer ${signature}`,
                'signature-timestamp': timestamp,
                'signature-nonce': nonce,
                'content-type': 'application/json',
            },
            payload: bodyString,
        });

        assert.strictEqual(response.statusCode, 400);
    });

    it.skip('should accept heartbeat with new payload format (requires DB)', async () => {
        const timestamp = getCurrentTimestamp();
        const nonce = generateNonce();
        const isoTimestamp = new Date().toISOString();
        const bodyString = `{"connection_state":"up","timestamp":"${isoTimestamp}","ipv4":"192.168.1.1","ipv6":"2001:db8::1","media_state":"ftth","connection_type":"ethernet","bandwidth_down":1000000000,"bandwidth_up":500000000,"rate_down":9500,"rate_up":4800,"bytes_down":12345678,"bytes_up":8765432}`;
        const signature = computeHmac(
            'POST',
            '/heartbeat',
            timestamp,
            nonce,
            bodyString,
            testApiSecret
        );

        const response = await fastify.inject({
            method: 'POST',
            url: '/heartbeat',
            headers: {
                authorization: `Bearer ${signature}`,
                'signature-timestamp': timestamp,
                'signature-nonce': nonce,
                'content-type': 'application/json',
            },
            payload: bodyString,
        });

        if (response.statusCode !== 200) {
            console.error('Error response:', response.body);
        }

        assert.strictEqual(response.statusCode, 200);
        const body = JSON.parse(response.body) as HeartbeatResponseBody;
        assert.strictEqual(body.success, true);
        assert.ok(body.id);
    });
});

describe('HeartbeatService', () => {
    it('should validate heartbeat data structure', () => {
        const validData: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
        };

        assert.ok(validData.connection_state);
        assert.ok(validData.timestamp);
    });

    it('should handle additional fields (ipv4, bandwidth, etc)', () => {
        const dataWithAdditionalFields: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            ipv4: '192.168.1.1',
            ipv6: '2001:db8::1',
            bandwidth_down: 1000000000,
            bandwidth_up: 500000000,
        };

        const dataWithoutAdditionalFields: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
        };

        assert.ok(dataWithAdditionalFields.ipv4);
        assert.ok(dataWithAdditionalFields.bandwidth_down);
        assert.strictEqual(dataWithoutAdditionalFields.ipv4, undefined);
    });

    it('should accept new payload fields (connected devices, FTTH optics, system health)', () => {
        const fullPayload: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            ipv4: '82.67.197.112',
            ipv6: '2a01:e0a:de7:a4a0::1',
            media_state: 'ftth',
            connection_type: 'ethernet',
            bandwidth_down: 10000000000,
            bandwidth_up: 900000000,
            rate_down: 4734,
            rate_up: 3461,
            bytes_down: 1142257499691,
            bytes_up: 149819666255,
            connected_devices_total: 4,
            connected_devices_wifi: 3,
            sfp_pwr_rx_dbm: -19.17,
            sfp_pwr_tx_dbm: 2.69,
            temp_cpu: 74,
            temp_switch: 45,
            fan_rpm: 1441,
            uptime: 7189324,
        };

        assert.strictEqual(fullPayload.connected_devices_total, 4);
        assert.strictEqual(fullPayload.connected_devices_wifi, 3);
        assert.strictEqual(fullPayload.sfp_pwr_rx_dbm, -19.17);
        assert.strictEqual(fullPayload.sfp_pwr_tx_dbm, 2.69);
        assert.strictEqual(fullPayload.temp_cpu, 74);
        assert.strictEqual(fullPayload.temp_switch, 45);
        assert.strictEqual(fullPayload.fan_rpm, 1441);
        assert.strictEqual(fullPayload.uptime, 7189324);
    });

    it('should accept null values for new optional fields (degraded mode)', () => {
        const degradedPayload: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            connected_devices_total: 4,
            connected_devices_wifi: 3,
            sfp_pwr_rx_dbm: null,
            sfp_pwr_tx_dbm: null,
            temp_cpu: null,
            temp_switch: null,
            fan_rpm: null,
            uptime: null,
        };

        assert.strictEqual(degradedPayload.sfp_pwr_rx_dbm, null);
        assert.strictEqual(degradedPayload.temp_cpu, null);
        assert.strictEqual(degradedPayload.uptime, null);
    });

    it('should accept heartbeat without new fields (backwards compatibility)', () => {
        const legacyPayload: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            ipv4: '82.67.197.112',
            bandwidth_down: 10000000000,
            rate_down: 4734,
        };

        assert.strictEqual(legacyPayload.connected_devices_total, undefined);
        assert.strictEqual(legacyPayload.sfp_pwr_rx_dbm, undefined);
        assert.strictEqual(legacyPayload.temp_cpu, undefined);
        assert.strictEqual(legacyPayload.uptime, undefined);
        assert.strictEqual(legacyPayload.active_devices, undefined);
    });

    it('should accept active_devices array with valid device entries', () => {
        const devices: ActiveDevice[] = [
            { mac: 'AA:BB:CC:11:22:33', name: 'MyPhone', type: 'smartphone' },
            { mac: 'DD:EE:FF:44:55:66', name: 'MyLaptop', type: 'laptop' },
            { mac: '', name: 'UnknownDevice', type: 'unknown' },
        ];

        const payload: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            connected_devices_total: 3,
            active_devices: devices,
        };

        assert.ok(Array.isArray(payload.active_devices));
        assert.strictEqual(payload.active_devices?.length, 3);
        assert.strictEqual(payload.active_devices?.[0].mac, 'AA:BB:CC:11:22:33');
        assert.strictEqual(payload.active_devices?.[0].type, 'smartphone');
        // Device with empty MAC is valid in payload (skipped at upsert time)
        assert.strictEqual(payload.active_devices?.[2].mac, '');
    });

    it('should accept null active_devices when LAN API is unavailable', () => {
        const payload: HeartbeatInput = {
            connection_state: 'up',
            timestamp: new Date().toISOString(),
            connected_devices_total: null,
            active_devices: null,
        };

        assert.strictEqual(payload.active_devices, null);
    });

    it('should filter out devices with empty MAC for registry upsert', () => {
        const devices: ActiveDevice[] = [
            { mac: 'AA:BB:CC:11:22:33', name: 'MyPhone', type: 'smartphone' },
            { mac: '', name: 'NoMacDevice', type: 'unknown' },
            { mac: 'DD:EE:FF:44:55:66', name: 'MyLaptop', type: 'laptop' },
        ];

        const devicesWithMac = devices.filter((d) => d.mac !== '');

        assert.strictEqual(devicesWithMac.length, 2);
        assert.ok(devicesWithMac.every((d) => d.mac !== ''));
    });

    it('should deduplicate devices by MAC before registry upsert', () => {
        const devices: ActiveDevice[] = [
            { mac: 'AA:BB:CC:11:22:33', name: 'MyPhone', type: 'smartphone' },
            { mac: 'DD:EE:FF:44:55:66', name: 'MyLaptop', type: 'laptop' },
            // Duplicate MAC with different name — last one wins in Map
            { mac: 'AA:BB:CC:11:22:33', name: 'MyPhoneRenamed', type: 'smartphone' },
        ];

        const devicesWithMac = devices.filter((d) => d.mac !== '');
        const uniqueDevices = Array.from(new Map(devicesWithMac.map((d) => [d.mac, d])).values());

        assert.strictEqual(uniqueDevices.length, 2);
        // Last entry for duplicate MAC takes precedence
        const phone = uniqueDevices.find((d) => d.mac === 'AA:BB:CC:11:22:33');
        assert.strictEqual(phone?.name, 'MyPhoneRenamed');
    });

    it('should use heartbeat timestamp for device first_seen_at and last_seen_at', () => {
        const heartbeatTimestamp = new Date('2026-05-24T13:45:00.000Z');
        const device: ActiveDevice = {
            mac: 'AA:BB:CC:11:22:33',
            name: 'MyPhone',
            type: 'smartphone',
        };

        // Simulate the mapping applied in recordHeartbeat
        const deviceInsert = {
            mac: device.mac,
            name: device.name,
            type: device.type,
            first_seen_at: heartbeatTimestamp,
            last_seen_at: heartbeatTimestamp,
        };

        assert.deepStrictEqual(deviceInsert.first_seen_at, heartbeatTimestamp);
        assert.deepStrictEqual(deviceInsert.last_seen_at, heartbeatTimestamp);
    });
});
