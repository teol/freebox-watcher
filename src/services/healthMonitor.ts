import type { FastifyBaseLogger } from 'fastify';
import type { HeartbeatService } from './heartbeat.js';
import type { NotificationService } from './notification.js';
import {
    analyzeHealth,
    type HealthChecksConfig,
    type HealthCheckId,
    type HealthCheckResult,
    type HealthEvent,
    type TemperatureConfig,
} from './healthChecks.js';

export interface HealthMonitorConfig extends HealthChecksConfig {
    /** Master switch of the monitor, each alert can also be disabled individually */
    enabled: boolean;
    /** Interval between two checks, also used as the analysis window length */
    checkIntervalMs: number;
}

export interface HealthReport {
    /** Checks that became degraded or whose severity changed */
    degraded: HealthCheckResult[];
    /** Checks that went back to normal */
    recovered: HealthCheckResult[];
    /** Newly detected events */
    events: HealthEvent[];
}

const ALERT_KEYS = [
    'fiber',
    'lineRate',
    'media',
    'reboot',
    'publicIp',
    'diskSpace',
    'diskErrors',
    'diskTemp',
    'cpuTemp',
    'switchTemp',
    'fan',
] as const;

function parseNumber(name: string, defaultValue: number): number {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === '') {
        return defaultValue;
    }

    const value = Number(raw);
    if (!Number.isFinite(value)) {
        throw new Error(`Invalid ${name}: '${raw}' is not a valid number`);
    }

    return value;
}

/**
 * Every switch is enabled unless explicitly set to 'false'
 */
function parseEnabled(name: string): boolean {
    return process.env[name] !== 'false';
}

function parseTemperature(
    prefix: string,
    defaultWarning: number,
    defaultCritical: number
): TemperatureConfig {
    const config: TemperatureConfig = {
        enabled: parseEnabled(`${prefix}_ENABLED`),
        warning: parseNumber(`${prefix}_WARNING`, defaultWarning),
        critical: parseNumber(`${prefix}_CRITICAL`, defaultCritical),
    };

    if (config.critical < config.warning) {
        throw new Error(
            `Invalid ${prefix}_CRITICAL: must be greater than or equal to ${prefix}_WARNING`
        );
    }

    return config;
}

/**
 * Load and validate the health monitor configuration from environment variables
 */
export function loadHealthMonitorConfig(): HealthMonitorConfig {
    const config: HealthMonitorConfig = {
        enabled: parseEnabled('HEALTH_MONITOR_ENABLED'),
        checkIntervalMs: parseNumber('HEALTH_CHECK_INTERVAL', 900000),
        baselineHours: parseNumber('HEALTH_BASELINE_HOURS', 24),
        fiber: {
            enabled: parseEnabled('HEALTH_FIBER_ENABLED'),
            rxWarningDbm: parseNumber('HEALTH_FIBER_RX_WARNING_DBM', -25),
            rxCriticalDbm: parseNumber('HEALTH_FIBER_RX_CRITICAL_DBM', -27),
            dropDb: parseNumber('HEALTH_FIBER_DROP_DB', 2),
        },
        lineRate: {
            enabled: parseEnabled('HEALTH_LINE_RATE_ENABLED'),
            dropPercent: parseNumber('HEALTH_LINE_RATE_DROP_PERCENT', 20),
        },
        media: { enabled: parseEnabled('HEALTH_MEDIA_ENABLED') },
        reboot: { enabled: parseEnabled('HEALTH_REBOOT_ENABLED') },
        publicIp: { enabled: parseEnabled('HEALTH_PUBLIC_IP_ENABLED') },
        diskSpace: {
            enabled: parseEnabled('HEALTH_DISK_SPACE_ENABLED'),
            warningPercent: parseNumber('HEALTH_DISK_SPACE_WARNING_PERCENT', 90),
            criticalPercent: parseNumber('HEALTH_DISK_SPACE_CRITICAL_PERCENT', 95),
        },
        diskErrors: { enabled: parseEnabled('HEALTH_DISK_ERRORS_ENABLED') },
        diskTemp: parseTemperature('HEALTH_DISK_TEMP', 55, 60),
        cpuTemp: parseTemperature('HEALTH_CPU_TEMP', 90, 100),
        switchTemp: parseTemperature('HEALTH_SWITCH_TEMP', 80, 90),
        fan: { enabled: parseEnabled('HEALTH_FAN_ENABLED') },
    };

    if (config.checkIntervalMs < 60000) {
        throw new Error('Invalid HEALTH_CHECK_INTERVAL: must be at least 60000 ms');
    }
    if (config.baselineHours <= 0) {
        throw new Error('Invalid HEALTH_BASELINE_HOURS: must be greater than 0');
    }
    if (config.fiber.rxCriticalDbm > config.fiber.rxWarningDbm) {
        throw new Error(
            'Invalid HEALTH_FIBER_RX_CRITICAL_DBM: must be lower than or equal to HEALTH_FIBER_RX_WARNING_DBM'
        );
    }
    if (config.fiber.dropDb <= 0) {
        throw new Error('Invalid HEALTH_FIBER_DROP_DB: must be greater than 0');
    }
    if (config.lineRate.dropPercent <= 0 || config.lineRate.dropPercent > 100) {
        throw new Error(
            'Invalid HEALTH_LINE_RATE_DROP_PERCENT: must be between 0 (excluded) and 100'
        );
    }
    const { warningPercent, criticalPercent } = config.diskSpace;
    if (warningPercent <= 0 || criticalPercent > 100 || criticalPercent < warningPercent) {
        throw new Error(
            'Invalid HEALTH_DISK_SPACE_*_PERCENT: expected 0 < WARNING <= CRITICAL <= 100'
        );
    }

    return config;
}

/**
 * HealthMonitor periodically analyzes recent heartbeats and sends a Telegram notification when
 * the Freebox health degrades (fiber signal, line rate, disk, temperatures...) or when a notable
 * event happens (reboot, public IP change, disk errors).
 * Only changes are notified (degraded, severity change, recovered, new event) to avoid alert storms.
 */
export class HealthMonitor {
    private timeoutId: NodeJS.Timeout | null = null;
    // Degraded checks already notified; kept in memory, so an ongoing degradation is notified again after a restart
    private readonly activeIssues = new Map<HealthCheckId, HealthCheckResult>();
    private lastEventSampleAt: Date | null = null;
    private readonly logger: FastifyBaseLogger;
    private readonly notificationService: NotificationService;
    private readonly heartbeatService: HeartbeatService;
    private readonly config: HealthMonitorConfig;

    constructor(
        logger: FastifyBaseLogger,
        notificationService: NotificationService,
        heartbeatService: HeartbeatService,
        config: HealthMonitorConfig = loadHealthMonitorConfig()
    ) {
        this.logger = logger.child({ service: 'HealthMonitor' });
        this.notificationService = notificationService;
        this.heartbeatService = heartbeatService;
        this.config = config;
    }

    /**
     * Names of the alerts enabled in the configuration
     */
    getEnabledAlerts(): string[] {
        return ALERT_KEYS.filter((key) => this.config[key].enabled);
    }

    /**
     * Start the periodic health checks
     */
    start(): void {
        const enabledAlerts = this.getEnabledAlerts();

        if (!this.config.enabled || enabledAlerts.length === 0) {
            this.logger.info(
                'Health monitor disabled by HEALTH_MONITOR_ENABLED or by disabling every alert'
            );
            return;
        }

        if (this.timeoutId) {
            this.logger.warn('HealthMonitor is already running');
            return;
        }

        this.logger.info(
            {
                checkIntervalMinutes: this.config.checkIntervalMs / 60000,
                baselineHours: this.config.baselineHours,
                enabledAlerts,
            },
            'Starting health monitor'
        );

        const runCheck = async (): Promise<void> => {
            try {
                await this.check();
            } catch (error) {
                this.logger.error({ error }, 'Error in health check');
            }
            // If the monitor has not been stopped, schedule the next check
            if (this.timeoutId) {
                this.timeoutId = setTimeout(runCheck, this.config.checkIntervalMs);
            }
        };
        this.timeoutId = setTimeout(runCheck, this.config.checkIntervalMs);
    }

    /**
     * Stop the periodic health checks
     */
    stop(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            this.logger.info('Health monitor stopped');
        }
    }

    /**
     * Analyze the recent heartbeats and notify the health changes since the previous check
     * @param now Reference time of the check
     * @returns The notified changes, or null when nothing changed
     */
    async check(now: Date = new Date()): Promise<HealthReport | null> {
        const windowStart = new Date(now.getTime() - this.config.checkIntervalMs);
        const baselineStart = new Date(
            windowStart.getTime() - this.config.baselineHours * 3600 * 1000
        );

        const samples = await this.heartbeatService.getHealthSamples(baselineStart, now);
        const analysis = analyzeHealth(samples, windowStart, this.config);
        const report = this.diff(analysis.results, analysis.events);

        if (!report) {
            this.logger.debug(
                { evaluatedChecks: analysis.results.length, activeIssues: this.activeIssues.size },
                'Health unchanged'
            );
            return null;
        }

        this.logger.warn(
            {
                degraded: report.degraded.map((r) => ({ check: r.check, severity: r.severity })),
                recovered: report.recovered.map((r) => r.check),
                events: report.events.map((e) => e.kind),
            },
            'Health changed'
        );

        if (this.notificationService.isEnabled()) {
            await this.notificationService.sendHealthAlert(report);
        }

        return report;
    }

    /**
     * Compare the analysis with the already notified issues and events, and update the state
     */
    private diff(results: HealthCheckResult[], events: HealthEvent[]): HealthReport | null {
        const degraded: HealthCheckResult[] = [];
        const recovered: HealthCheckResult[] = [];

        // Checks without enough data are not in results: their previous state is kept
        for (const result of results) {
            const previous = this.activeIssues.get(result.check);

            if (result.severity !== null) {
                if (previous?.severity !== result.severity) {
                    degraded.push(result);
                }
                this.activeIssues.set(result.check, result);
            } else if (previous) {
                recovered.push(result);
                this.activeIssues.delete(result.check);
            }
        }

        const lastNotifiedAt = this.lastEventSampleAt?.getTime() ?? -Infinity;
        const newEvents = events
            .filter((event) => event.sampleAt.getTime() > lastNotifiedAt)
            .sort((a, b) => a.sampleAt.getTime() - b.sampleAt.getTime());
        if (newEvents.length > 0) {
            this.lastEventSampleAt = newEvents[newEvents.length - 1].sampleAt;
        }

        if (degraded.length === 0 && recovered.length === 0 && newEvents.length === 0) {
            return null;
        }

        return { degraded, recovered, events: newEvents };
    }
}
