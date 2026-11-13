import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance } from 'fastify';
import {
    analyzeHealth,
    median,
    formatBitrate,
    formatBytes,
    type HealthChecksConfig,
    type HealthSample,
} from '../src/services/healthChecks.js';
import {
    HealthMonitor,
    loadHealthMonitorConfig,
    type HealthMonitorConfig,
    type HealthReport,
} from '../src/services/healthMonitor.js';
import { NotificationService } from '../src/services/notification.js';
import { HeartbeatService } from '../src/services/heartbeat.js';

const NOW = new Date('2026-11-13T12:00:00.000Z');
const WINDOW_MS = 15 * 60000;
const WINDOW_START = new Date(NOW.getTime() - WINDOW_MS);

const CONFIG: HealthChecksConfig = {
    baselineHours: 24,
    fiber: { enabled: true, rxWarningDbm: -25, rxCriticalDbm: -27, dropDb: 2 },
    lineRate: { enabled: true, dropPercent: 20 },
    media: { enabled: true },
    reboot: { enabled: true },
    publicIp: { enabled: true },
    diskSpace: { enabled: true, warningPercent: 90, criticalPercent: 95 },
    diskErrors: { enabled: true },
    diskTemp: { enabled: true, warning: 55, critical: 60 },
    cpuTemp: { enabled: true, warning: 90, critical: 100 },
    switchTemp: { enabled: true, warning: 80, critical: 90 },
    fan: { enabled: true },
};

const ALL_DISABLED: HealthChecksConfig = {
    ...CONFIG,
    fiber: { ...CONFIG.fiber, enabled: false },
    lineRate: { ...CONFIG.lineRate, enabled: false },
    media: { enabled: false },
    reboot: { enabled: false },
    publicIp: { enabled: false },
    diskSpace: { ...CONFIG.diskSpace, enabled: false },
    diskErrors: { enabled: false },
    diskTemp: { ...CONFIG.diskTemp, enabled: false },
    cpuTemp: { ...CONFIG.cpuTemp, enabled: false },
    switchTemp: { ...CONFIG.switchTemp, enabled: false },
    fan: { enabled: false },
};

const HEALTHY: Omit<HealthSample, 'timestamp'> = {
    ipv4: '82.67.197.112',
    ipv6: '2a01:e0a:de7:a4a0::1',
    media_state: 'ftth',
    bandwidth_down: 8_000_000_000,
    bandwidth_up: 700_000_000,
    sfp_pwr_rx_dbm: -18,
    sfp_pwr_tx_dbm: 3,
    temp_cpu: 65,
    temp_switch: 55,
    fan_rpm: 1800,
    uptime: 100_000,
    disk_temp: 40,
    disk_used_bytes: 500_000_000_000,
    disk_total_bytes: 1_000_000_000_000,
    disk_read_errors: 0,
    disk_write_errors: 0,
};

/**
 * Build one sample per minute: `baselineCount` before the window, `windowCount` within it
 */
function buildSamples(
    baselineOverrides: Partial<HealthSample>,
    windowOverrides: Partial<HealthSample>,
    baselineCount = 60,
    windowCount = 15
): HealthSample[] {
    const samples: HealthSample[] = [];
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

function analyze(samples: HealthSample[], config: HealthChecksConfig = CONFIG) {
    return analyzeHealth(samples, WINDOW_START, config);
}

function resultFor(samples: HealthSample[], check: string) {
    return analyze(samples).results.find((r) => r.check === check);
}

describe('healthChecks helpers', () => {
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

    it('should format sizes with an adapted unit', () => {
        assert.strictEqual(formatBytes(2_500_000_000_000), '2.50 TB');
        assert.strictEqual(formatBytes(73_100_000_000), '73.1 GB');
        assert.strictEqual(formatBytes(512_000_000), '512 MB');
    });
});

describe('analyzeHealth', () => {
    it('should report every check as healthy and no event for a healthy Freebox', () => {
        const analysis = analyze(buildSamples({}, {}));

        assert.deepStrictEqual(analysis.results.map((r) => r.check).sort(), [
            'cpu_temp',
            'disk_space',
            'disk_temp',
            'fan',
            'fiber_rx',
            'fiber_tx',
            'line_rate_down',
            'line_rate_up',
            'media',
            'switch_temp',
        ]);
        assert.ok(analysis.results.every((r) => r.severity === null && r.reason === null));
        assert.deepStrictEqual(analysis.events, []);
    });

    it('should evaluate nothing when every alert is disabled', () => {
        const samples = buildSamples({}, { sfp_pwr_rx_dbm: -30, uptime: 60, ipv4: '1.2.3.4' });

        assert.deepStrictEqual(analyze(samples, ALL_DISABLED), { results: [], events: [] });
    });

    it('should only evaluate the enabled alerts', () => {
        const analysis = analyze(buildSamples({}, { disk_temp: 62, uptime: 60 }), {
            ...ALL_DISABLED,
            diskTemp: CONFIG.diskTemp,
        });

        assert.deepStrictEqual(
            analysis.results.map((r) => [r.check, r.severity]),
            [['disk_temp', 'critical']]
        );
        assert.deepStrictEqual(analysis.events, []);
    });

    describe('fiber', () => {
        it('should raise a critical alert below the critical RX threshold', () => {
            const result = resultFor(buildSamples({}, { sfp_pwr_rx_dbm: -27.5 }), 'fiber_rx');

            assert.strictEqual(result?.severity, 'critical');
            assert.strictEqual(result?.current, '-27.5 dBm');
            assert.match(result?.reason ?? '', /critical threshold: -27\.0 dBm/);
        });

        it('should raise a warning below the warning RX threshold', () => {
            const result = resultFor(
                buildSamples({ sfp_pwr_rx_dbm: -24.5 }, { sfp_pwr_rx_dbm: -25.5 }),
                'fiber_rx'
            );

            assert.strictEqual(result?.severity, 'warning');
            assert.match(result?.reason ?? '', /warning threshold/);
        });

        it('should raise a warning when RX power drops compared to the baseline', () => {
            const result = resultFor(buildSamples({}, { sfp_pwr_rx_dbm: -20.5 }), 'fiber_rx');

            assert.strictEqual(result?.severity, 'warning');
            assert.match(result?.reason ?? '', /2\.5 dB below baseline \(-18\.0 dBm\)/);
        });

        it('should ignore isolated spikes thanks to the median', () => {
            const samples = buildSamples({}, {});
            samples[samples.length - 1].sfp_pwr_rx_dbm = -30;
            samples[samples.length - 2].sfp_pwr_rx_dbm = -30;

            assert.strictEqual(resultFor(samples, 'fiber_rx')?.severity, null);
        });

        it('should raise a warning when TX power drops compared to the baseline', () => {
            const result = resultFor(buildSamples({}, { sfp_pwr_tx_dbm: 0.5 }), 'fiber_tx');

            assert.strictEqual(result?.severity, 'warning');
            assert.match(result?.reason ?? '', /2\.5 dB below/);
        });
    });

    it('should raise a warning when the line rate drops compared to the baseline', () => {
        const result = resultFor(
            buildSamples({}, { bandwidth_down: 4_000_000_000 }),
            'line_rate_down'
        );

        assert.strictEqual(result?.severity, 'warning');
        assert.strictEqual(result?.current, '4.00 Gbit/s');
        assert.match(result?.reason ?? '', /50% below baseline \(8\.00 Gbit\/s\)/);
    });

    it('should raise a warning when the connection media changes', () => {
        const result = resultFor(buildSamples({}, { media_state: 'backup_4g' }), 'media');

        assert.strictEqual(result?.severity, 'warning');
        assert.strictEqual(result?.current, 'backup_4g');
        assert.match(result?.reason ?? '', /usual media over the last 24h is ftth/);
    });

    describe('disk space', () => {
        it('should raise a warning, then a critical alert, as the disk fills up', () => {
            const warning = resultFor(
                buildSamples({}, { disk_used_bytes: 920_000_000_000 }),
                'disk_space'
            );
            assert.strictEqual(warning?.severity, 'warning');
            assert.strictEqual(warning?.current, '92.0% used (80.0 GB free)');
            assert.match(warning?.reason ?? '', /warning threshold: 90%/);

            const critical = resultFor(
                buildSamples({}, { disk_used_bytes: 990_000_000_000 }),
                'disk_space'
            );
            assert.strictEqual(critical?.severity, 'critical');
        });

        it('should use the latest value', () => {
            const samples = buildSamples({}, { disk_used_bytes: 990_000_000_000 });
            samples[samples.length - 1].disk_used_bytes = 100_000_000_000;

            assert.strictEqual(resultFor(samples, 'disk_space')?.severity, null);
        });

        it('should skip the check without disk', () => {
            const samples = buildSamples(
                {},
                { disk_used_bytes: null, disk_total_bytes: null },
                60,
                15
            );

            assert.strictEqual(resultFor(samples, 'disk_space'), undefined);
        });
    });

    describe('temperatures', () => {
        it('should raise a warning, then a critical alert, for the disk temperature', () => {
            assert.strictEqual(
                resultFor(buildSamples({}, { disk_temp: 56 }), 'disk_temp')?.severity,
                'warning'
            );
            const critical = resultFor(buildSamples({}, { disk_temp: 60 }), 'disk_temp');
            assert.strictEqual(critical?.severity, 'critical');
            assert.strictEqual(critical?.current, '60°C');
            assert.match(critical?.reason ?? '', /critical threshold: 60°C/);
        });

        it('should check the CPU and switch temperatures', () => {
            const samples = buildSamples({}, { temp_cpu: 92, temp_switch: 95 });

            assert.strictEqual(resultFor(samples, 'cpu_temp')?.severity, 'warning');
            assert.strictEqual(resultFor(samples, 'switch_temp')?.severity, 'critical');
        });
    });

    describe('fan', () => {
        it('should raise a critical alert when the fan stops', () => {
            const result = resultFor(buildSamples({}, { fan_rpm: 0 }), 'fan');

            assert.strictEqual(result?.severity, 'critical');
            assert.match(result?.reason ?? '', /fan stopped \(usually 1800 rpm\)/);
        });

        it('should not report a fan that never spins', () => {
            assert.strictEqual(
                resultFor(buildSamples({ fan_rpm: 0 }, { fan_rpm: 0 }), 'fan'),
                undefined
            );
        });
    });

    it('should skip checks without enough data', () => {
        // Not enough baseline samples: only the absolute thresholds can be evaluated
        const analysis = analyze(buildSamples({}, {}, 5, 15));
        assert.deepStrictEqual(analysis.results.map((r) => r.check).sort(), [
            'cpu_temp',
            'disk_space',
            'disk_temp',
            'fiber_rx',
            'switch_temp',
        ]);

        // Not enough window samples for medians
        const sparse = analyze(buildSamples({}, {}, 60, 2));
        assert.deepStrictEqual(sparse.results.map((r) => r.check).sort(), ['disk_space', 'media']);
    });

    describe('events', () => {
        it('should detect a reboot within the window from an uptime reset', () => {
            const samples = buildSamples({}, {});
            const rebootSample = samples[samples.length - 5];
            for (const sample of samples.slice(-5)) {
                sample.uptime =
                    120 + (sample.timestamp.getTime() - rebootSample.timestamp.getTime()) / 1000;
            }

            const [event] = analyze(samples).events;

            assert.strictEqual(event.kind, 'reboot');
            assert.strictEqual(event.sampleAt, rebootSample.timestamp);
            assert.match(
                event.message,
                new RegExp(new Date(rebootSample.timestamp.getTime() - 120_000).toISOString())
            );
        });

        it('should detect public IPv4 and IPv6 changes', () => {
            const events = analyze(
                buildSamples({}, { ipv4: '82.67.1.1', ipv6: '2a01:e0a:1::1' })
            ).events;

            assert.deepStrictEqual(
                events.map((e) => [e.kind, e.message]),
                [
                    ['public_ipv4', 'Public IPv4 changed from 82.67.197.112 to 82.67.1.1'],
                    [
                        'public_ipv6',
                        'Public IPv6 changed from 2a01:e0a:de7:a4a0::1 to 2a01:e0a:1::1',
                    ],
                ]
            );
        });

        it('should aggregate the disk errors increases of the window in one event', () => {
            const samples = buildSamples({ disk_read_errors: 3 }, { disk_read_errors: 3 });
            samples[samples.length - 4].disk_read_errors = 5;
            samples[samples.length - 3].disk_read_errors = 5;
            samples[samples.length - 2].disk_read_errors = 6;
            samples[samples.length - 1].disk_read_errors = 6;
            samples[samples.length - 1].disk_write_errors = 1;

            const events = analyze(samples).events;

            assert.deepStrictEqual(events, [
                {
                    kind: 'disk_errors',
                    sampleAt: samples[samples.length - 1].timestamp,
                    message: 'Disk errors increased: +3 read (total 6), +1 write (total 1)',
                },
            ]);
        });

        it('should ignore disk error counters reset by a reboot', () => {
            assert.deepStrictEqual(
                analyze(buildSamples({ disk_read_errors: 5 }, { disk_read_errors: 0 })).events,
                []
            );
        });

        it('should not report events that happened before the window', () => {
            const samples = buildSamples({}, {});
            samples[10].uptime = 60;
            samples[10].ipv4 = '1.2.3.4';
            samples[11].disk_write_errors = 4;

            assert.deepStrictEqual(analyze(samples).events, []);
        });
    });
});

describe('loadHealthMonitorConfig', () => {
    const touched = new Set<string>();

    function setEnv(name: string, value: string): void {
        touched.add(name);
        process.env[name] = value;
    }

    beforeEach(() => {
        for (const name of Object.keys(process.env)) {
            if (name.startsWith('HEALTH_')) {
                delete process.env[name];
            }
        }
    });

    after(() => {
        for (const name of touched) {
            delete process.env[name];
        }
    });

    it('should enable every alert with default thresholds', () => {
        assert.deepStrictEqual(loadHealthMonitorConfig(), {
            ...CONFIG,
            enabled: true,
            checkIntervalMs: 900000,
        });
    });

    it('should read values from environment variables', () => {
        setEnv('HEALTH_MONITOR_ENABLED', 'false');
        setEnv('HEALTH_CHECK_INTERVAL', '600000');
        setEnv('HEALTH_FIBER_RX_WARNING_DBM', '-24');
        setEnv('HEALTH_DISK_SPACE_WARNING_PERCENT', '80');
        setEnv('HEALTH_CPU_TEMP_WARNING', '85');

        const config = loadHealthMonitorConfig();

        assert.strictEqual(config.enabled, false);
        assert.strictEqual(config.checkIntervalMs, 600000);
        assert.strictEqual(config.fiber.rxWarningDbm, -24);
        assert.strictEqual(config.diskSpace.warningPercent, 80);
        assert.strictEqual(config.cpuTemp.warning, 85);
    });

    it('should disable each alert individually', () => {
        const switches: Array<[string, keyof HealthChecksConfig]> = [
            ['HEALTH_FIBER_ENABLED', 'fiber'],
            ['HEALTH_LINE_RATE_ENABLED', 'lineRate'],
            ['HEALTH_MEDIA_ENABLED', 'media'],
            ['HEALTH_REBOOT_ENABLED', 'reboot'],
            ['HEALTH_PUBLIC_IP_ENABLED', 'publicIp'],
            ['HEALTH_DISK_SPACE_ENABLED', 'diskSpace'],
            ['HEALTH_DISK_ERRORS_ENABLED', 'diskErrors'],
            ['HEALTH_DISK_TEMP_ENABLED', 'diskTemp'],
            ['HEALTH_CPU_TEMP_ENABLED', 'cpuTemp'],
            ['HEALTH_SWITCH_TEMP_ENABLED', 'switchTemp'],
            ['HEALTH_FAN_ENABLED', 'fan'],
        ];

        for (const [variable, key] of switches) {
            setEnv(variable, 'false');
            const config = loadHealthMonitorConfig();
            delete process.env[variable];

            const disabled = switches.filter(
                ([, k]) => !(config[k] as { enabled: boolean }).enabled
            );
            assert.deepStrictEqual(
                disabled.map(([, k]) => k),
                [key],
                `${variable} must only disable ${key}`
            );
        }
    });

    it('should reject invalid values', () => {
        setEnv('HEALTH_FIBER_DROP_DB', 'abc');
        assert.throws(() => loadHealthMonitorConfig(), /Invalid HEALTH_FIBER_DROP_DB: 'abc'/);
        delete process.env.HEALTH_FIBER_DROP_DB;

        setEnv('HEALTH_CHECK_INTERVAL', '1000');
        assert.throws(() => loadHealthMonitorConfig(), /HEALTH_CHECK_INTERVAL: must be at least/);
        delete process.env.HEALTH_CHECK_INTERVAL;

        setEnv('HEALTH_FIBER_RX_CRITICAL_DBM', '-20');
        assert.throws(() => loadHealthMonitorConfig(), /HEALTH_FIBER_RX_CRITICAL_DBM/);
        delete process.env.HEALTH_FIBER_RX_CRITICAL_DBM;

        setEnv('HEALTH_DISK_TEMP_CRITICAL', '50');
        assert.throws(
            () => loadHealthMonitorConfig(),
            /Invalid HEALTH_DISK_TEMP_CRITICAL: must be greater than or equal to HEALTH_DISK_TEMP_WARNING/
        );
        delete process.env.HEALTH_DISK_TEMP_CRITICAL;

        setEnv('HEALTH_DISK_SPACE_CRITICAL_PERCENT', '120');
        assert.throws(() => loadHealthMonitorConfig(), /HEALTH_DISK_SPACE_\*_PERCENT/);
    });
});

describe('HealthMonitor', () => {
    let fastify: FastifyInstance;
    let notificationService: NotificationService;
    let sentReports: HealthReport[];

    const config: HealthMonitorConfig = {
        ...CONFIG,
        enabled: true,
        checkIntervalMs: WINDOW_MS,
    };

    function createMonitor(
        samplesProvider: () => HealthSample[],
        monitorConfig: HealthMonitorConfig = config
    ): HealthMonitor {
        const heartbeatService = new HeartbeatService();
        heartbeatService.getHealthSamples = async () => samplesProvider();
        return new HealthMonitor(fastify.log, notificationService, heartbeatService, monitorConfig);
    }

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(() => {
        sentReports = [];
        notificationService = new NotificationService(fastify.log);
        notificationService.isEnabled = () => true;
        notificationService.sendHealthAlert = async (report: HealthReport) => {
            sentReports.push(report);
            return true;
        };
    });

    after(async () => {
        await fastify.close();
    });

    it('should notify nothing while the Freebox is healthy', async () => {
        const monitor = createMonitor(() => buildSamples({}, {}));

        assert.strictEqual(await monitor.check(NOW), null);
        assert.strictEqual(sentReports.length, 0);
    });

    it('should notify a degradation once, then its escalation and its recovery', async () => {
        let samples = buildSamples({}, { disk_used_bytes: 920_000_000_000 });
        const monitor = createMonitor(() => samples);

        const first = await monitor.check(NOW);
        assert.deepStrictEqual(
            first?.degraded.map((r) => [r.check, r.severity]),
            [['disk_space', 'warning']]
        );

        // Same degradation: no new notification
        assert.strictEqual(await monitor.check(NOW), null);

        samples = buildSamples({}, { disk_used_bytes: 990_000_000_000 });
        const escalation = await monitor.check(NOW);
        assert.deepStrictEqual(
            escalation?.degraded.map((r) => [r.check, r.severity]),
            [['disk_space', 'critical']]
        );

        samples = buildSamples({}, {});
        const recovery = await monitor.check(NOW);
        assert.deepStrictEqual(recovery?.degraded, []);
        assert.deepStrictEqual(
            recovery?.recovered.map((r) => r.check),
            ['disk_space']
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

    it('should notify each event only once', async () => {
        const samples = buildSamples({}, {});
        samples[samples.length - 3].uptime = 60;
        samples[samples.length - 2].uptime = 120;
        samples[samples.length - 1].uptime = 180;
        samples[samples.length - 1].ipv4 = '82.67.1.1';
        const monitor = createMonitor(() => samples);

        const report = await monitor.check(NOW);
        assert.deepStrictEqual(
            report?.events.map((e) => e.kind),
            ['reboot', 'public_ipv4']
        );

        assert.strictEqual(await monitor.check(NOW), null);
    });

    it('should not send notifications when Telegram is disabled', async () => {
        notificationService.isEnabled = () => false;
        const monitor = createMonitor(() => buildSamples({}, { sfp_pwr_rx_dbm: -28 }));

        const report = await monitor.check(NOW);

        assert.strictEqual(report?.degraded.length, 1);
        assert.strictEqual(sentReports.length, 0);
    });

    it('should list the enabled alerts', () => {
        const monitor = createMonitor(() => [], {
            ...config,
            ...ALL_DISABLED,
            fan: { enabled: true },
        });

        assert.deepStrictEqual(monitor.getEnabledAlerts(), ['fan']);
    });

    it('should not start when disabled by the master switch', () => {
        const monitor = createMonitor(() => [], { ...config, enabled: false });

        monitor.start();
        assert.strictEqual((monitor as any).timeoutId, null);
    });

    it('should not start when every alert is disabled', () => {
        const monitor = createMonitor(() => [], { ...config, ...ALL_DISABLED });

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

describe('NotificationService.sendHealthAlert', () => {
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
            sendMessage: async ({ text: message }: { text: string }) => {
                messages.push(message);
            },
        };
        return service;
    }

    it('should send one aggregated message with escaped values', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendHealthAlert({
            improved: [],
            degraded: [
                {
                    check: 'fiber_rx',
                    label: 'Fiber RX power',
                    current: '-27.5 dBm',
                    severity: 'critical',
                    reason: 'critical threshold: -27.0 dBm',
                    reference: null,
                },
                {
                    check: 'media',
                    label: 'Connection media',
                    current: 'backup_4g',
                    severity: 'warning',
                    reason: 'usual media over the last 24h is ftth',
                    reference: null,
                },
            ],
            recovered: [
                {
                    check: 'disk_space',
                    label: 'Disk space',
                    current: '50.0% used (500.0 GB free)',
                    severity: null,
                    reason: null,
                    reference: null,
                },
            ],
            events: [
                {
                    kind: 'reboot',
                    sampleAt: new Date('2026-11-13T11:52:00.000Z'),
                    message: 'Freebox rebooted around 2026-11-13T11:50:00.000Z',
                },
                {
                    kind: 'disk_errors',
                    sampleAt: new Date('2026-11-13T11:55:00.000Z'),
                    message: 'Disk errors increased: +3 read (total 6)',
                },
            ],
        });

        assert.strictEqual(messages.length, 1);
        assert.match(messages[0], /Freebox Health Degraded/);
        assert.match(messages[0], /🔴 \*Fiber RX power\*: -27\.5 dBm/);
        assert.match(messages[0], /🟠 \*Connection media\*: backup\\_4g/);
        assert.match(messages[0], /✅ \*Disk space\*: back to normal \(50\.0% used/);
        assert.match(messages[0], /🔄 Freebox rebooted around 2026-11-13T11:50:00\.000Z/);
        assert.match(messages[0], /💾 Disk errors increased: \+3 read/);
    });

    it('should use a recovery title when nothing is degraded', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendHealthAlert({
            degraded: [],
            improved: [],
            recovered: [
                {
                    check: 'fiber_rx',
                    label: 'Fiber RX power',
                    current: '-18.0 dBm',
                    severity: null,
                    reason: null,
                    reference: null,
                },
            ],
            events: [],
        });

        assert.match(messages[0], /Freebox Health Restored/);
    });

    it('should use an events title for events only', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendHealthAlert({
            degraded: [],
            improved: [],
            recovered: [],
            events: [
                {
                    kind: 'public_ipv4',
                    sampleAt: new Date(),
                    message: 'Public IPv4 changed from 82.67.197.112 to 82.67.1.1',
                },
            ],
        });

        assert.match(messages[0], /Freebox Events/);
        assert.match(messages[0], /🌐 Public IPv4 changed/);
    });

    it('should use an improving title for severity improvements only', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        const delivered = await service.sendHealthAlert({
            degraded: [],
            improved: [
                {
                    check: 'disk_temp',
                    label: 'Disk temperature',
                    current: '56°C',
                    severity: 'warning',
                    reason: 'warning threshold: 55°C',
                    reference: null,
                },
            ],
            recovered: [],
            events: [],
        });

        assert.strictEqual(delivered, true);
        assert.match(messages[0], /Freebox Health Improving/);
        assert.match(messages[0], /🟠 \*Disk temperature\*: 56°C \(improved\)/);
    });

    it('should report a failed delivery', async () => {
        const service = createService([]);
        (service as any).bot = {
            sendMessage: async () => {
                throw new Error('ETELEGRAM: 429 Too Many Requests');
            },
        };

        const delivered = await service.sendHealthAlert({
            degraded: [],
            improved: [],
            recovered: [],
            events: [{ kind: 'reboot', sampleAt: new Date(), message: 'Freebox rebooted' }],
        });

        assert.strictEqual(delivered, false);
    });

    it('should send nothing for an empty report', async () => {
        const messages: string[] = [];
        const service = createService(messages);

        await service.sendHealthAlert({ degraded: [], improved: [], recovered: [], events: [] });

        assert.strictEqual(messages.length, 0);
    });
});

/**
 * Build one sample per minute ending just before NOW, from consecutive segments of
 * [duration in minutes, overrides]; the last 15 minutes make up the analysis window
 */
function timeline(
    segments: Array<[number, Partial<HealthSample>]>,
    end: Date = NOW
): HealthSample[] {
    const total = segments.reduce((minutes, [duration]) => minutes + duration, 0);
    let time = end.getTime() - total * 60000;
    const samples: HealthSample[] = [];
    for (const [duration, overrides] of segments) {
        for (let i = 0; i < duration; i++) {
            samples.push({ ...HEALTHY, ...overrides, timestamp: new Date(time) });
            time += 60000;
        }
    }
    return samples;
}

describe('HealthMonitor review regressions', () => {
    let fastify: FastifyInstance;
    let notificationService: NotificationService;
    let sentReports: HealthReport[];
    let deliveries: boolean[];

    const config: HealthMonitorConfig = { ...CONFIG, enabled: true, checkIntervalMs: WINDOW_MS };

    /**
     * Monitor whose heartbeat source honors the queried time range, like the database does
     */
    function createMonitor(
        source: { samples: HealthSample[]; fail?: boolean },
        monitorConfig: HealthMonitorConfig = config
    ): HealthMonitor {
        const heartbeatService = new HeartbeatService();
        heartbeatService.getHealthSamples = async (start: Date, end: Date) => {
            if (source.fail) {
                throw new Error('Database unavailable');
            }
            return source.samples.filter((s) => s.timestamp >= start && s.timestamp <= end);
        };
        return new HealthMonitor(fastify.log, notificationService, heartbeatService, monitorConfig);
    }

    /**
     * Heartbeats until `end`, with the public IPv4 changing one minute before NOW
     */
    function ipChangeTimeline(end: Date, overrides: Partial<HealthSample> = {}): HealthSample[] {
        const minutes = 120 + Math.round((end.getTime() - NOW.getTime()) / 60000);
        return timeline([[minutes, overrides]], end).map((s) =>
            s.timestamp.getTime() >= NOW.getTime() - 60000 ? { ...s, ipv4: '82.67.1.1' } : s
        );
    }

    const NEXT_RUN = new Date(NOW.getTime() + WINDOW_MS + 10000);

    before(async () => {
        fastify = Fastify({ logger: false });
        await fastify.ready();
    });

    beforeEach(() => {
        sentReports = [];
        deliveries = [];
        notificationService = new NotificationService(fastify.log);
        notificationService.isEnabled = () => true;
        notificationService.sendHealthAlert = async (report: HealthReport) => {
            const delivered = deliveries.shift() ?? true;
            if (delivered) {
                sentReports.push(report);
            }
            return delivered;
        };
    });

    after(async () => {
        await fastify.close();
    });

    describe('degradations lasting longer than half the baseline', () => {
        for (const [check, degraded] of [
            ['line_rate_down', { bandwidth_down: 1_000_000_000 }],
            ['fiber_rx', { sfp_pwr_rx_dbm: -21 }],
            ['fiber_tx', { sfp_pwr_tx_dbm: 0 }],
            ['media', { media_state: 'backup_4g' }],
        ] as const) {
            it(`should keep ${check} degraded, then recover when it is back to normal`, async () => {
                const source = {
                    samples: timeline([
                        [600, {}],
                        [15, degraded],
                    ]),
                };
                const monitor = createMonitor(source);

                const first = await monitor.check(NOW);
                assert.deepStrictEqual(
                    first?.degraded.map((r) => r.check),
                    [check]
                );

                // Degraded for 14 hours: the degraded values make up most of the baseline
                source.samples = timeline([
                    [600, {}],
                    [840, degraded],
                ]);
                assert.strictEqual(await monitor.check(NOW), null);

                source.samples = timeline([
                    [600, {}],
                    [825, degraded],
                    [15, {}],
                ]);
                const recovery = await monitor.check(NOW);
                assert.deepStrictEqual(recovery?.degraded, []);
                assert.deepStrictEqual(
                    recovery?.recovered.map((r) => r.check),
                    [check]
                );
            });
        }
    });

    describe('fan', () => {
        it('should recover as soon as a fan stopped for a long time spins again', async () => {
            const source = {
                samples: timeline([
                    [600, {}],
                    [15, { fan_rpm: 0 }],
                ]),
            };
            const monitor = createMonitor(source);

            assert.deepStrictEqual(
                (await monitor.check(NOW))?.degraded.map((r) => [r.check, r.severity]),
                [['fan', 'critical']]
            );

            source.samples = timeline([
                [600, {}],
                [840, { fan_rpm: 0 }],
                [15, {}],
            ]);
            assert.deepStrictEqual(
                (await monitor.check(NOW))?.recovered.map((r) => r.check),
                ['fan']
            );
        });

        it('should report a fan stopped for longer than half the baseline after a restart', () => {
            const result = analyze(
                timeline([
                    [600, {}],
                    [840, { fan_rpm: 0 }],
                ])
            ).results.find((r) => r.check === 'fan');

            assert.strictEqual(result?.severity, 'critical');
            assert.match(result?.reason ?? '', /usually 1800 rpm/);
        });
    });

    describe('events between two runs', () => {
        it('should notify an event that happened right after the previous run', async () => {
            const end = new Date(NOW.getTime() + 20 * 60000);
            const samples = timeline([[120, {}]], NOW);
            samples.push({
                ...HEALTHY,
                ipv4: '82.67.1.1',
                timestamp: new Date(NOW.getTime() + 5000),
            });
            for (let minute = 1; minute <= 20; minute++) {
                samples.push({
                    ...HEALTHY,
                    ipv4: '82.67.1.1',
                    timestamp: new Date(NOW.getTime() + 5000 + minute * 60000),
                });
            }
            const monitor = createMonitor({ samples: samples.filter((s) => s.timestamp <= end) });

            assert.strictEqual(await monitor.check(NOW), null);
            const report = await monitor.check(new Date(NOW.getTime() + WINDOW_MS + 10000));

            assert.deepStrictEqual(
                report?.events.map((e) => e.kind),
                ['public_ipv4']
            );
        });

        it('should catch up on the events of a failed run', async () => {
            const source = { samples: timeline([[120, {}]]), fail: false };
            const monitor = createMonitor(source);
            await monitor.check(NOW);

            // Reboot during the next interval, whose check fails
            const later = new Date(NOW.getTime() + WINDOW_MS);
            const reboot = new Date(NOW.getTime() + 2 * 60000);
            source.samples = [
                ...source.samples,
                ...timeline([[30, {}]], new Date(later.getTime() + WINDOW_MS)).map((s) =>
                    s.timestamp >= reboot
                        ? { ...s, uptime: (s.timestamp.getTime() - reboot.getTime()) / 1000 + 60 }
                        : s
                ),
            ];
            source.fail = true;
            await assert.rejects(monitor.check(later));

            source.fail = false;
            const report = await monitor.check(new Date(later.getTime() + WINDOW_MS));
            assert.deepStrictEqual(
                report?.events.map((e) => e.kind),
                ['reboot']
            );
        });

        it('should not count disk errors twice when runs overlap', async () => {
            const samples = timeline([[60, {}]]);
            samples[samples.length - 2].disk_read_errors = 2;
            samples[samples.length - 1].disk_read_errors = 2;
            const source = { samples };
            const monitor = createMonitor(source);

            assert.match(
                (await monitor.check(NOW))?.events[0].message ?? '',
                /\+2 read \(total 2\)/
            );

            const later = new Date(NOW.getTime() + 5 * 60000);
            source.samples = [
                ...samples,
                { ...HEALTHY, disk_read_errors: 3, timestamp: new Date(NOW.getTime() + 60000) },
            ];
            const report = await monitor.check(later);
            assert.deepStrictEqual(
                report?.events.map((e) => e.message),
                ['Disk errors increased: +1 read (total 3)']
            );
        });
    });

    describe('notification delivery', () => {
        it('should retry a degradation and its events on the next scheduled run', async () => {
            const monitor = createMonitor({
                samples: ipChangeTimeline(NEXT_RUN, { temp_cpu: 101 }),
            });

            deliveries = [false];
            await monitor.check(NOW);
            assert.strictEqual(sentReports.length, 0);

            const retry = await monitor.check(NEXT_RUN);
            assert.deepStrictEqual(
                retry?.degraded.map((r) => [r.check, r.severity]),
                [['cpu_temp', 'critical']]
            );
            assert.deepStrictEqual(
                retry?.events.map((e) => e.kind),
                ['public_ipv4']
            );
            assert.strictEqual(sentReports.length, 1);
        });

        it('should retry the events of a very first run whose delivery failed', async () => {
            const monitor = createMonitor({ samples: ipChangeTimeline(NEXT_RUN) });

            deliveries = [false];
            await monitor.check(NOW);

            assert.deepStrictEqual(
                (await monitor.check(NEXT_RUN))?.events.map((e) => e.kind),
                ['public_ipv4']
            );
        });

        it('should catch up on the events of a very first run whose query failed', async () => {
            const source = { samples: ipChangeTimeline(NEXT_RUN), fail: true };
            const monitor = createMonitor(source);

            await assert.rejects(monitor.check(NOW));
            source.fail = false;

            assert.deepStrictEqual(
                (await monitor.check(NEXT_RUN))?.events.map((e) => e.kind),
                ['public_ipv4']
            );
        });
    });

    describe('after a recovery', () => {
        it('should keep the usual media while the baseline still holds the backup period', async () => {
            const backup = { media_state: 'backup_4g' };
            const source = {
                samples: timeline([
                    [600, {}],
                    [15, backup],
                ]),
            };
            const monitor = createMonitor(source);
            await monitor.check(NOW);

            source.samples = timeline([
                [600, {}],
                [825, backup],
                [15, {}],
            ]);
            assert.deepStrictEqual(
                (await monitor.check(NOW))?.recovered.map((r) => r.check),
                ['media']
            );

            // Next runs: the baseline still mostly holds the backup media, then only FTTH
            source.samples = timeline([
                [600, {}],
                [810, backup],
                [30, {}],
            ]);
            assert.strictEqual(await monitor.check(NOW), null);
            source.samples = timeline([[1440, {}]]);
            assert.strictEqual(await monitor.check(NOW), null);

            // A new backup period is still compared to FTTH
            source.samples = timeline([
                [1425, {}],
                [15, backup],
            ]);
            const report = await monitor.check(NOW);
            assert.match(report?.degraded[0]?.reason ?? '', /is ftth$/);
        });

        it('should keep the usual media until the degraded samples left the baseline', async () => {
            const backup = { media_state: 'backup_4g' };
            const day = 24 * 3600 * 1000;
            // Backup from 13h45 before NOW, FTTH back for the last heartbeat before NOW only,
            // then no heartbeat until the 15 minutes before NOW + 1 day
            const source = {
                samples: [
                    ...timeline([
                        [600, {}],
                        [824, backup],
                        [1, {}],
                    ]),
                    ...timeline([[45, {}]], new Date(NOW.getTime() + day + 30 * 60000)),
                ],
            };
            const monitor = createMonitor(source);

            const degradedAt = new Date(NOW.getTime() - 810 * 60000);
            assert.deepStrictEqual(
                (await monitor.check(degradedAt))?.degraded.map((r) => r.check),
                ['media']
            );
            assert.deepStrictEqual(
                (await monitor.check(NOW))?.recovered.map((r) => r.check),
                ['media']
            );

            // The baseline still holds the backup samples of the window where FTTH came back
            assert.strictEqual(await monitor.check(new Date(NOW.getTime() + day)), null);
            // Right after they left the baseline, the reference comes from FTTH samples only
            assert.strictEqual(
                await monitor.check(new Date(NOW.getTime() + day + WINDOW_MS + 1000)),
                null
            );
        });

        it('should release the retained reference once the baseline period has passed', async () => {
            const source = {
                samples: timeline([
                    [600, {}],
                    [15, { media_state: 'xdsl' }],
                ]),
            };
            const monitor = createMonitor(source);
            await monitor.check(NOW);
            source.samples = timeline([
                [600, {}],
                [825, { media_state: 'xdsl' }],
                [15, {}],
            ]);
            await monitor.check(NOW);

            // The usual media really changed: once the baseline period has passed, it is accepted
            const later = new Date(NOW.getTime() + 25 * 3600 * 1000);
            source.samples = timeline([[1440, { media_state: 'xdsl' }]], later);
            assert.strictEqual(await monitor.check(later), null);
        });
    });

    describe('small drop thresholds', () => {
        for (const [name, overrides, degraded] of [
            [
                'line rate at 2%',
                { lineRate: { enabled: true, dropPercent: 2 } },
                { bandwidth_down: 4_000_000_000 },
            ],
            [
                'line rate at 1%',
                { lineRate: { enabled: true, dropPercent: 1 } },
                { bandwidth_down: 4_000_000_000 },
            ],
            ['fiber at 0.5 dB', { fiber: { ...CONFIG.fiber, dropDb: 0.5 } }, { sfp_pwr_tx_dbm: 1 }],
            ['fiber at 0.3 dB', { fiber: { ...CONFIG.fiber, dropDb: 0.3 } }, { sfp_pwr_tx_dbm: 1 }],
        ] as const) {
            it(`should recover with a ${name} threshold once back to the baseline`, async () => {
                const source = {
                    samples: timeline([
                        [60, {}],
                        [15, degraded],
                    ]),
                };
                const monitor = createMonitor(source, { ...config, ...overrides });
                assert.strictEqual((await monitor.check(NOW))?.degraded.length, 1);

                source.samples = timeline([[75, {}]]);
                assert.strictEqual((await monitor.check(NOW))?.recovered.length, 1);
            });
        }
    });

    describe('severity changes', () => {
        it('should report a severity improvement apart from degradations', async () => {
            const source = {
                samples: timeline([
                    [60, {}],
                    [15, { disk_temp: 61 }],
                ]),
            };
            const monitor = createMonitor(source);
            await monitor.check(NOW);

            source.samples = timeline([
                [60, {}],
                [15, { disk_temp: 56 }],
            ]);
            const report = await monitor.check(NOW);

            assert.deepStrictEqual(report?.degraded, []);
            assert.deepStrictEqual(
                report?.improved.map((r) => [r.check, r.severity]),
                [['disk_temp', 'warning']]
            );
        });

        it('should not flap when a value hovers around a threshold', async () => {
            const source = {
                samples: timeline([
                    [60, {}],
                    [15, { disk_temp: 55 }],
                ]),
            };
            const monitor = createMonitor(source);
            assert.strictEqual((await monitor.check(NOW))?.degraded.length, 1);

            source.samples = timeline([
                [60, {}],
                [15, { disk_temp: 54 }],
            ]);
            assert.strictEqual(await monitor.check(NOW), null);

            source.samples = timeline([
                [60, {}],
                [15, { disk_temp: 52 }],
            ]);
            assert.deepStrictEqual(
                (await monitor.check(NOW))?.recovered.map((r) => r.check),
                ['disk_temp']
            );
        });
    });
});
