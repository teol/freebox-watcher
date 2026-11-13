import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import {
    analyzeConnectionQuality,
    median,
    formatBitrate,
    type QualitySample,
    type QualityThresholds,
} from '../src/services/connectionQuality.js';
import {
    ConnectionQualityMonitor,
    loadQualityMonitorConfig,
    type QualityMonitorConfig,
    type QualityReport,
} from '../src/services/connectionQualityMonitor.js';
import { NotificationService } from '../src/services/notification.js';
import { HeartbeatService } from '../src/services/heartbeat.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const WINDOW_MS = 15 * 60000;
const WINDOW_START = new Date(NOW.getTime() - WINDOW_MS);

const THRESHOLDS: QualityThresholds = {
    baselineHours: 24,
    sfpRxWarningDbm: -25,
    sfpRxCriticalDbm: -27,
    sfpDropDb: 2,
    bandwidthDropPercent: 20,
};

const HEALTHY: Omit<QualitySample, 'timestamp'> = {
    media_state: 'ftth',
    bandwidth_down: 8_000_000_000,
    bandwidth_up: 700_000_000,
    sfp_pwr_rx_dbm: -18,
    sfp_pwr_tx_dbm: 3,
    uptime: 100_000,
};

/**
 * Build one sample per minute: `baselineCount` before the window, `windowCount` within it
 */
function buildSamples(
    baselineOverrides: Partial<QualitySample>,
    windowOverrides: Partial<QualitySample>,
    baselineCount = 60,
    windowCount = 15
): QualitySample[] {
    const samples: QualitySample[] = [];
    for (let i = baselineCount; i > 0; i--) {
        samples.push({
            ...HEALTHY,
            ...baselineOverrides,
            timestamp: new Date(WINDOW_START.getTime() - i * 60000),
        });
    }
    for (let i = 0; i < windowCount; i++) {
        samples.push({
            ...HEALTHY,
            ...windowOverrides,
            timestamp: new Date(WINDOW_START.getTime() + i * 60000),
        });
    }
    return samples;
}

function resultFor(samples: QualitySample[], check: string) {
    return analyzeConnectionQuality(samples, WINDOW_START, THRESHOLDS).results.find(
        (r) => r.check === check
    );
}

describe('connectionQuality helpers', () => {
    it('should compute the median of odd and even lists', () => {
        assert.strictEqual(median([]), null);
        assert.strictEqual(median([3, 1, 2]), 2);
        assert.strictEqual(median([4, 1, 3, 2]), 2.5);
    });

    it('should format bit rates with an adapted unit', () => {
        assert.strictEqual(formatBitrate(8_000_000_000), '8.00 Gbit/s');
        assert.strictEqual(formatBitrate(700_000_000), '700.0 Mbit/s');
        assert.strictEqual(formatBitrate(512_000), '512 kbit/s');
    });
});

describe('analyzeConnectionQuality', () => {
    it('should report every check as healthy for a stable connection', () => {
        const analysis = analyzeConnectionQuality(buildSamples({}, {}), WINDOW_START, THRESHOLDS);

        assert.deepStrictEqual(analysis.results.map((r) => r.check).sort(), [
            'bandwidth_down',
            'bandwidth_up',
            'media_state',
            'sfp_rx',
            'sfp_tx',
        ]);
        assert.ok(analysis.results.every((r) => r.severity === null && r.reason === null));
        assert.deepStrictEqual(analysis.reboots, []);
    });

    it('should raise a critical alert when fiber RX power is below the critical threshold', () => {
        const result = resultFor(buildSamples({}, { sfp_pwr_rx_dbm: -27.5 }), 'sfp_rx');

        assert.strictEqual(result?.severity, 'critical');
        assert.strictEqual(result?.current, '-27.5 dBm');
        assert.match(result?.reason ?? '', /critical threshold of -27\.0 dBm/);
    });

    it('should raise a warning when fiber RX power is below the warning threshold', () => {
        const result = resultFor(
            buildSamples({ sfp_pwr_rx_dbm: -24.5 }, { sfp_pwr_rx_dbm: -25.5 }),
            'sfp_rx'
        );

        assert.strictEqual(result?.severity, 'warning');
        assert.match(result?.reason ?? '', /warning threshold/);
    });

    it('should raise a warning when fiber RX power drops compared to the baseline', () => {
        const result = resultFor(buildSamples({}, { sfp_pwr_rx_dbm: -20.5 }), 'sfp_rx');

        assert.strictEqual(result?.severity, 'warning');
        assert.match(result?.reason ?? '', /2\.5 dB below 24h baseline \(-18\.0 dBm\)/);
    });

    it('should ignore isolated spikes thanks to the median', () => {
        const samples = buildSamples({}, {});
        samples[samples.length - 1].sfp_pwr_rx_dbm = -30;
        samples[samples.length - 2].sfp_pwr_rx_dbm = -30;

        assert.strictEqual(resultFor(samples, 'sfp_rx')?.severity, null);
    });

    it('should raise a warning when fiber TX power drops compared to the baseline', () => {
        const result = resultFor(buildSamples({}, { sfp_pwr_tx_dbm: 0.5 }), 'sfp_tx');

        assert.strictEqual(result?.severity, 'warning');
        assert.match(result?.reason ?? '', /2\.5 dB below/);
    });

    it('should raise a warning when the line rate drops compared to the baseline', () => {
        const result = resultFor(
            buildSamples({}, { bandwidth_down: 4_000_000_000 }),
            'bandwidth_down'
        );

        assert.strictEqual(result?.severity, 'warning');
        assert.strictEqual(result?.current, '4.00 Gbit/s');
        assert.match(result?.reason ?? '', /50% below 24h baseline \(8\.00 Gbit\/s\)/);
    });

    it('should raise a warning when the connection media changes', () => {
        const result = resultFor(buildSamples({}, { media_state: 'backup_4g' }), 'media_state');

        assert.strictEqual(result?.severity, 'warning');
        assert.strictEqual(result?.current, 'backup_4g');
        assert.match(result?.reason ?? '', /usual media over the last 24h is ftth/);
    });

    it('should skip checks without enough data', () => {
        // Not enough baseline samples: only the absolute RX thresholds can be evaluated
        const analysis = analyzeConnectionQuality(
            buildSamples({}, {}, 5, 15),
            WINDOW_START,
            THRESHOLDS
        );
        assert.deepStrictEqual(
            analysis.results.map((r) => r.check),
            ['sfp_rx']
        );

        // Not enough window samples
        const empty = analyzeConnectionQuality(
            buildSamples({}, {}, 60, 2),
            WINDOW_START,
            THRESHOLDS
        );
        assert.deepStrictEqual(
            empty.results.map((r) => r.check),
            ['media_state']
        );
    });

    it('should skip null values', () => {
        const analysis = analyzeConnectionQuality(
            buildSamples({ sfp_pwr_rx_dbm: null }, { sfp_pwr_rx_dbm: null }),
            WINDOW_START,
            THRESHOLDS
        );

        assert.strictEqual(
            analysis.results.find((r) => r.check === 'sfp_rx'),
            undefined
        );
    });

    it('should detect a reboot within the window from an uptime reset', () => {
        const samples = buildSamples({}, {});
        const rebootSample = samples[samples.length - 5];
        rebootSample.uptime = 120;
        for (const sample of samples.slice(-4)) {
            sample.uptime =
                120 + (sample.timestamp.getTime() - rebootSample.timestamp.getTime()) / 1000;
        }

        const analysis = analyzeConnectionQuality(samples, WINDOW_START, THRESHOLDS);

        assert.deepStrictEqual(analysis.reboots, [
            new Date(rebootSample.timestamp.getTime() - 120 * 1000),
        ]);
    });

    it('should not report reboots that happened before the window', () => {
        const samples = buildSamples({}, {});
        samples[10].uptime = 60;

        assert.deepStrictEqual(
            analyzeConnectionQuality(samples, WINDOW_START, THRESHOLDS).reboots,
            []
        );
    });
});

describe('loadQualityMonitorConfig', () => {
    const variables = [
        'QUALITY_MONITOR_ENABLED',
        'QUALITY_CHECK_INTERVAL',
        'QUALITY_BASELINE_HOURS',
        'QUALITY_SFP_RX_WARNING_DBM',
        'QUALITY_SFP_RX_CRITICAL_DBM',
        'QUALITY_SFP_DROP_DB',
        'QUALITY_BANDWIDTH_DROP_PERCENT',
    ];

    beforeEach(() => {
        for (const name of variables) {
            delete process.env[name];
        }
    });

    after(() => {
        for (const name of variables) {
            delete process.env[name];
        }
    });

    it('should use default values', () => {
        assert.deepStrictEqual(loadQualityMonitorConfig(), {
            enabled: true,
            checkIntervalMs: 900000,
            baselineHours: 24,
            sfpRxWarningDbm: -25,
            sfpRxCriticalDbm: -27,
            sfpDropDb: 2,
            bandwidthDropPercent: 20,
        });
    });

    it('should read values from environment variables', () => {
        process.env.QUALITY_MONITOR_ENABLED = 'false';
        process.env.QUALITY_CHECK_INTERVAL = '600000';
        process.env.QUALITY_SFP_RX_WARNING_DBM = '-24';

        const config = loadQualityMonitorConfig();

        assert.strictEqual(config.enabled, false);
        assert.strictEqual(config.checkIntervalMs, 600000);
        assert.strictEqual(config.sfpRxWarningDbm, -24);
    });

    it('should reject invalid values', () => {
        process.env.QUALITY_SFP_DROP_DB = 'abc';
        assert.throws(() => loadQualityMonitorConfig(), /Invalid QUALITY_SFP_DROP_DB: 'abc'/);
        delete process.env.QUALITY_SFP_DROP_DB;

        process.env.QUALITY_CHECK_INTERVAL = '1000';
        assert.throws(() => loadQualityMonitorConfig(), /QUALITY_CHECK_INTERVAL: must be at least/);
        delete process.env.QUALITY_CHECK_INTERVAL;

        process.env.QUALITY_SFP_RX_CRITICAL_DBM = '-20';
        assert.throws(() => loadQualityMonitorConfig(), /QUALITY_SFP_RX_CRITICAL_DBM/);
    });
});

describe('ConnectionQualityMonitor', () => {
    let fastify: FastifyInstance;
    let notificationService: NotificationService;
    let sentReports: QualityReport[];

    const config: QualityMonitorConfig = {
        ...THRESHOLDS,
        enabled: true,
        checkIntervalMs: WINDOW_MS,
    };

    function createMonitor(samplesProvider: () => QualitySample[]): ConnectionQualityMonitor {
        const heartbeatService = new HeartbeatService();
        heartbeatService.getQualitySamples = async () => samplesProvider();
        return new ConnectionQualityMonitor(
            fastify.log,
            notificationService,
            heartbeatService,
            config
        );
    }

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(() => {
        sentReports = [];
        notificationService = new NotificationService(fastify.log);
        notificationService.isEnabled = () => true;
        notificationService.sendConnectionQualityAlert = async (report: QualityReport) => {
            sentReports.push(report);
        };
    });

    after(async () => {
        await fastify.close();
    });

    it('should notify nothing while the connection is healthy', async () => {
        const monitor = createMonitor(() => buildSamples({}, {}));

        assert.strictEqual(await monitor.check(NOW), null);
        assert.strictEqual(sentReports.length, 0);
    });

    it('should notify a degradation once, then its escalation and its recovery', async () => {
        let samples = buildSamples({}, { sfp_pwr_rx_dbm: -25.5 });
        const monitor = createMonitor(() => samples);

        const first = await monitor.check(NOW);
        assert.deepStrictEqual(
            first?.degraded.map((r) => [r.check, r.severity]),
            [['sfp_rx', 'warning']]
        );

        // Same degradation: no new notification
        assert.strictEqual(await monitor.check(NOW), null);

        samples = buildSamples({}, { sfp_pwr_rx_dbm: -28 });
        const escalation = await monitor.check(NOW);
        assert.deepStrictEqual(
            escalation?.degraded.map((r) => [r.check, r.severity]),
            [['sfp_rx', 'critical']]
        );

        samples = buildSamples({}, {});
        const recovery = await monitor.check(NOW);
        assert.deepStrictEqual(recovery?.degraded, []);
        assert.deepStrictEqual(
            recovery?.recovered.map((r) => r.check),
            ['sfp_rx']
        );

        assert.strictEqual(sentReports.length, 3);
    });

    it('should keep the degraded state while data is missing', async () => {
        let samples = buildSamples({}, { sfp_pwr_rx_dbm: -28 });
        const monitor = createMonitor(() => samples);

        await monitor.check(NOW);

        // No heartbeat in the window (downtime): no recovery notified
        samples = buildSamples({}, {}, 60, 0);
        assert.strictEqual(await monitor.check(NOW), null);

        // Still degraded once heartbeats come back: no duplicate notification
        samples = buildSamples({}, { sfp_pwr_rx_dbm: -28 });
        assert.strictEqual(await monitor.check(NOW), null);
        assert.strictEqual(sentReports.length, 1);
    });

    it('should notify each reboot only once', async () => {
        const samples = buildSamples({}, {});
        samples[samples.length - 3].uptime = 60;
        samples[samples.length - 2].uptime = 120;
        samples[samples.length - 1].uptime = 180;
        const monitor = createMonitor(() => samples);

        const report = await monitor.check(NOW);
        assert.strictEqual(report?.reboots.length, 1);

        assert.strictEqual(await monitor.check(NOW), null);
    });

    it('should not send notifications when Telegram is disabled', async () => {
        notificationService.isEnabled = () => false;
        const monitor = createMonitor(() => buildSamples({}, { sfp_pwr_rx_dbm: -28 }));

        const report = await monitor.check(NOW);

        assert.strictEqual(report?.degraded.length, 1);
        assert.strictEqual(sentReports.length, 0);
    });

    it('should not start when disabled', () => {
        const monitor = new ConnectionQualityMonitor(
            fastify.log,
            notificationService,
            new HeartbeatService(),
            { ...config, enabled: false }
        );

        monitor.start();
        assert.strictEqual((monitor as any).timeoutId, null);
    });

    it('should start and stop without errors', () => {
        const monitor = createMonitor(() => []);

        monitor.start();
        assert.notStrictEqual((monitor as any).timeoutId, null);
        monitor.stop();
        assert.strictEqual((monitor as any).timeoutId, null);
    });
});

describe('NotificationService.sendConnectionQualityAlert', () => {
    let fastify: FastifyInstance;

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    function createService(messages: string[]): NotificationService {
        const service = new NotificationService(fastify.log);
        (service as any).enabled = true;
        (service as any).chatId = 'chat-123';
        (service as any).bot = {
            sendMessage: async (_chatId: string, message: string) => {
                messages.push(message);
            },
        };
        return service;
    }

    it('should send one aggregated message with escaped values', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendConnectionQualityAlert({
            degraded: [
                {
                    check: 'sfp_rx',
                    label: 'Fiber RX power',
                    current: '-27.5 dBm',
                    severity: 'critical',
                    reason: 'below critical threshold of -27.0 dBm',
                },
                {
                    check: 'media_state',
                    label: 'Connection media',
                    current: 'backup_4g',
                    severity: 'warning',
                    reason: 'usual media over the last 24h is ftth',
                },
            ],
            recovered: [
                {
                    check: 'bandwidth_down',
                    label: 'Line rate (down)',
                    current: '8.00 Gbit/s',
                    severity: null,
                    reason: null,
                },
            ],
            reboots: [new Date('2026-11-13T11:50:00.000Z')],
        });

        assert.strictEqual(messages.length, 1);
        assert.match(messages[0], /Connection Quality Degraded/);
        assert.match(messages[0], /🔴 \*Fiber RX power\*: -27\.5 dBm/);
        assert.match(messages[0], /🟠 \*Connection media\*: backup\\_4g/);
        assert.match(messages[0], /✅ \*Line rate \(down\)\*: back to normal \(8\.00 Gbit\/s\)/);
        assert.match(messages[0], /Freebox rebooted around 2026-11-13T11:50:00\.000Z/);
    });

    it('should use a recovery title when nothing is degraded', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendConnectionQualityAlert({
            degraded: [],
            recovered: [
                {
                    check: 'sfp_rx',
                    label: 'Fiber RX power',
                    current: '-18.0 dBm',
                    severity: null,
                    reason: null,
                },
            ],
            reboots: [],
        });

        assert.match(messages[0], /Connection Quality Restored/);
    });

    it('should send nothing for an empty report', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendConnectionQualityAlert({ degraded: [], recovered: [], reboots: [] });

        assert.strictEqual(messages.length, 0);
    });
});
