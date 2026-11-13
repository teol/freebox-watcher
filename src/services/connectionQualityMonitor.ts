import type { FastifyBaseLogger } from 'fastify';
import type { HeartbeatService } from './heartbeat.js';
import type { NotificationService } from './notification.js';
import {
    analyzeConnectionQuality,
    type QualityCheckId,
    type QualityCheckResult,
    type QualityThresholds,
} from './connectionQuality.js';

export interface QualityMonitorConfig extends QualityThresholds {
    enabled: boolean;
    /** Interval between two checks, also used as the analysis window length */
    checkIntervalMs: number;
}

export interface QualityReport {
    /** Checks that became degraded or whose severity changed */
    degraded: QualityCheckResult[];
    /** Checks that went back to normal */
    recovered: QualityCheckResult[];
    /** Estimated boot times of newly detected Freebox reboots */
    reboots: Date[];
}

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
 * Load and validate the connection quality monitor configuration from environment variables
 */
export function loadQualityMonitorConfig(): QualityMonitorConfig {
    const config: QualityMonitorConfig = {
        enabled: process.env.QUALITY_MONITOR_ENABLED !== 'false',
        checkIntervalMs: parseNumber('QUALITY_CHECK_INTERVAL', 900000),
        baselineHours: parseNumber('QUALITY_BASELINE_HOURS', 24),
        sfpRxWarningDbm: parseNumber('QUALITY_SFP_RX_WARNING_DBM', -25),
        sfpRxCriticalDbm: parseNumber('QUALITY_SFP_RX_CRITICAL_DBM', -27),
        sfpDropDb: parseNumber('QUALITY_SFP_DROP_DB', 2),
        bandwidthDropPercent: parseNumber('QUALITY_BANDWIDTH_DROP_PERCENT', 20),
    };

    if (config.checkIntervalMs < 60000) {
        throw new Error('Invalid QUALITY_CHECK_INTERVAL: must be at least 60000 ms');
    }
    if (config.baselineHours <= 0) {
        throw new Error('Invalid QUALITY_BASELINE_HOURS: must be greater than 0');
    }
    if (config.sfpRxCriticalDbm > config.sfpRxWarningDbm) {
        throw new Error(
            'Invalid QUALITY_SFP_RX_CRITICAL_DBM: must be lower than or equal to QUALITY_SFP_RX_WARNING_DBM'
        );
    }
    if (config.sfpDropDb <= 0) {
        throw new Error('Invalid QUALITY_SFP_DROP_DB: must be greater than 0');
    }
    if (config.bandwidthDropPercent <= 0 || config.bandwidthDropPercent > 100) {
        throw new Error(
            'Invalid QUALITY_BANDWIDTH_DROP_PERCENT: must be between 0 (excluded) and 100'
        );
    }

    return config;
}

/**
 * ConnectionQualityMonitor periodically analyzes recent heartbeats and sends a Telegram
 * notification when the connection quality degrades (fiber signal, line rate, media, reboots).
 * Only state changes are notified (degraded, severity change, recovered) to avoid alert storms.
 */
export class ConnectionQualityMonitor {
    private timeoutId: NodeJS.Timeout | null = null;
    // Degraded checks already notified; kept in memory, so an ongoing degradation is notified again after a restart
    private readonly activeIssues = new Map<QualityCheckId, QualityCheckResult>();
    private lastReportedRebootAt: Date | null = null;
    private readonly logger: FastifyBaseLogger;
    private readonly notificationService: NotificationService;
    private readonly heartbeatService: HeartbeatService;
    private readonly config: QualityMonitorConfig;

    constructor(
        logger: FastifyBaseLogger,
        notificationService: NotificationService,
        heartbeatService: HeartbeatService,
        config: QualityMonitorConfig = loadQualityMonitorConfig()
    ) {
        this.logger = logger.child({ service: 'ConnectionQualityMonitor' });
        this.notificationService = notificationService;
        this.heartbeatService = heartbeatService;
        this.config = config;
    }

    /**
     * Start the periodic connection quality checks
     */
    start(): void {
        if (!this.config.enabled) {
            this.logger.info('Connection quality monitor disabled by QUALITY_MONITOR_ENABLED');
            return;
        }

        if (this.timeoutId) {
            this.logger.warn('ConnectionQualityMonitor is already running');
            return;
        }

        this.logger.info(
            {
                checkIntervalMinutes: this.config.checkIntervalMs / 60000,
                baselineHours: this.config.baselineHours,
            },
            'Starting connection quality monitor'
        );

        const runCheck = async (): Promise<void> => {
            try {
                await this.check();
            } catch (error) {
                this.logger.error({ error }, 'Error in connection quality check');
            }
            // If the monitor has not been stopped, schedule the next check
            if (this.timeoutId) {
                this.timeoutId = setTimeout(runCheck, this.config.checkIntervalMs);
            }
        };
        this.timeoutId = setTimeout(runCheck, this.config.checkIntervalMs);
    }

    /**
     * Stop the periodic connection quality checks
     */
    stop(): void {
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
            this.logger.info('Connection quality monitor stopped');
        }
    }

    /**
     * Analyze the recent heartbeats and notify the quality changes since the previous check
     * @param now Reference time of the check
     * @returns The notified changes, or null when nothing changed
     */
    async check(now: Date = new Date()): Promise<QualityReport | null> {
        const windowStart = new Date(now.getTime() - this.config.checkIntervalMs);
        const baselineStart = new Date(
            windowStart.getTime() - this.config.baselineHours * 3600 * 1000
        );

        const samples = await this.heartbeatService.getQualitySamples(baselineStart, now);
        const analysis = analyzeConnectionQuality(samples, windowStart, this.config);
        const report = this.diff(analysis.results, analysis.reboots);

        if (!report) {
            this.logger.debug(
                { evaluatedChecks: analysis.results.length, activeIssues: this.activeIssues.size },
                'Connection quality unchanged'
            );
            return null;
        }

        this.logger.warn(
            {
                degraded: report.degraded.map((r) => ({ check: r.check, severity: r.severity })),
                recovered: report.recovered.map((r) => r.check),
                reboots: report.reboots.map((d) => d.toISOString()),
            },
            'Connection quality changed'
        );

        if (this.notificationService.isEnabled()) {
            await this.notificationService.sendConnectionQualityAlert(report);
        }

        return report;
    }

    /**
     * Compare the check results with the already notified issues and update the state
     */
    private diff(results: QualityCheckResult[], reboots: Date[]): QualityReport | null {
        const degraded: QualityCheckResult[] = [];
        const recovered: QualityCheckResult[] = [];

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

        const newReboots = reboots.filter(
            (bootAt) =>
                this.lastReportedRebootAt === null ||
                bootAt.getTime() > this.lastReportedRebootAt.getTime()
        );
        if (newReboots.length > 0) {
            this.lastReportedRebootAt = newReboots[newReboots.length - 1];
        }

        if (degraded.length === 0 && recovered.length === 0 && newReboots.length === 0) {
            return null;
        }

        return { degraded, recovered, reboots: newReboots };
    }
}
