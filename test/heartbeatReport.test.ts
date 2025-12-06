import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import HeartbeatReportService from '../src/services/heartbeatReport.js';
import heartbeatService from '../src/services/heartbeat.js';

describe('HeartbeatReportService', () => {
    let fastify: FastifyInstance;
    let tempDir: string;

    beforeEach(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'heartbeat-report-test-'));
        delete process.env.DISCORD_WEBHOOK_URL;
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        await fastify.close();
    });

    it('should not start scheduling without a webhook', () => {
        const service = new HeartbeatReportService(fastify.log, tempDir);

        service.start();

        assert.strictEqual((service as any).timer, null);
    });

    it('should select appropriate units based on maximum rate', () => {
        const service = new HeartbeatReportService(fastify.log, tempDir);

        const bps = (service as any).getRateUnit(900);
        const kbps = (service as any).getRateUnit(1500);
        const mbps = (service as any).getRateUnit(2_500_000);
        const gbps = (service as any).getRateUnit(3_000_000_000);

        assert.strictEqual(bps.label, 'bps');
        assert.strictEqual(kbps.label, 'Kbps');
        assert.strictEqual(mbps.label, 'Mbps');
        assert.strictEqual(gbps.label, 'Gbps');
    });

    it('should generate and clean up the report when webhook is configured', async () => {
        process.env.DISCORD_WEBHOOK_URL = 'https://example.com/webhook';
        const service = new HeartbeatReportService(fastify.log, tempDir);

        const originalGetAllHeartbeats = heartbeatService.getAllHeartbeats;
        const sampleTimestamps = [
            new Date('2024-01-01T05:00:00Z'),
            new Date('2024-01-01T06:00:00Z'),
            new Date('2024-01-01T07:00:00Z'),
        ];
        heartbeatService.getAllHeartbeats = async () =>
            sampleTimestamps.map((timestamp, index) => ({
                id: index + 1,
                status: 'up',
                timestamp,
                received_at: timestamp,
                ipv4: null,
                ipv6: null,
                media_state: null,
                connection_type: null,
                bandwidth_down: null,
                bandwidth_up: null,
                rate_down: 1500 * (index + 1),
                rate_up: 800 * (index + 1),
                bytes_down: null,
                bytes_up: null,
                metadata: null,
            }));

        const fetchCalls: Array<{ url: string; options: unknown }> = [];
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input: any, init?: any) => {
            fetchCalls.push({ url: input as string, options: init });
            return {
                ok: true,
                status: 204,
                text: async () => '',
            } as any;
        };

        try {
            await service.runReport();

            assert.strictEqual(fetchCalls.length, 1);
            const files = await fs.readdir(tempDir);
            assert.deepStrictEqual(files, []);
        } finally {
            heartbeatService.getAllHeartbeats = originalGetAllHeartbeats;
            globalThis.fetch = originalFetch;
            await fs.rm(tempDir, { recursive: true, force: true });
        }
    });
});
