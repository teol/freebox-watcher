import type { HeartbeatsTable } from '../types/database.js';

/**
 * Heartbeat columns needed to analyze the Freebox health
 */
export type HealthSample = Pick<
    HeartbeatsTable,
    | 'timestamp'
    | 'ipv4'
    | 'ipv6'
    | 'media_state'
    | 'bandwidth_down'
    | 'bandwidth_up'
    | 'sfp_pwr_rx_dbm'
    | 'sfp_pwr_tx_dbm'
    | 'temp_cpu'
    | 'temp_switch'
    | 'fan_rpm'
    | 'uptime'
    | 'disk_temp'
    | 'disk_used_bytes'
    | 'disk_total_bytes'
    | 'disk_read_errors'
    | 'disk_write_errors'
>;

export const HEALTH_SAMPLE_COLUMNS: (keyof HealthSample)[] = [
    'timestamp',
    'ipv4',
    'ipv6',
    'media_state',
    'bandwidth_down',
    'bandwidth_up',
    'sfp_pwr_rx_dbm',
    'sfp_pwr_tx_dbm',
    'temp_cpu',
    'temp_switch',
    'fan_rpm',
    'uptime',
    'disk_temp',
    'disk_used_bytes',
    'disk_total_bytes',
    'disk_read_errors',
    'disk_write_errors',
];

/**
 * Checks evaluated on every run, notified when they become degraded and when they recover
 */
export type HealthCheckId =
    | 'fiber_rx'
    | 'fiber_tx'
    | 'line_rate_down'
    | 'line_rate_up'
    | 'media'
    | 'disk_space'
    | 'disk_temp'
    | 'cpu_temp'
    | 'switch_temp'
    | 'fan';

/**
 * One-shot events, notified once when they happen
 */
export type HealthEventKind = 'reboot' | 'public_ipv4' | 'public_ipv6' | 'disk_errors';

export type HealthSeverity = 'warning' | 'critical';

export interface ToggleConfig {
    enabled: boolean;
}

export interface TemperatureConfig extends ToggleConfig {
    /** Temperature (°C) at or above which a warning is raised */
    warning: number;
    /** Temperature (°C) at or above which a critical alert is raised */
    critical: number;
}

export interface FiberConfig extends ToggleConfig {
    /** RX power (dBm) below which a warning is raised */
    rxWarningDbm: number;
    /** RX power (dBm) below which a critical alert is raised */
    rxCriticalDbm: number;
    /** RX/TX power drop (dB) compared to the baseline that raises a warning */
    dropDb: number;
}

export interface LineRateConfig extends ToggleConfig {
    /** Line rate drop (percent) compared to the baseline that raises a warning */
    dropPercent: number;
}

export interface DiskSpaceConfig extends ToggleConfig {
    /** Used space (percent) at or above which a warning is raised */
    warningPercent: number;
    /** Used space (percent) at or above which a critical alert is raised */
    criticalPercent: number;
}

export interface HealthChecksConfig {
    /** Length of the baseline period preceding the analysis window */
    baselineHours: number;
    fiber: FiberConfig;
    lineRate: LineRateConfig;
    media: ToggleConfig;
    reboot: ToggleConfig;
    publicIp: ToggleConfig;
    diskSpace: DiskSpaceConfig;
    diskErrors: ToggleConfig;
    diskTemp: TemperatureConfig;
    cpuTemp: TemperatureConfig;
    switchTemp: TemperatureConfig;
    fan: ToggleConfig;
}

/**
 * Usual value a relative check compares the current one to (median or most frequent value)
 */
export type HealthReference = number | string;

export interface HealthCheckResult {
    check: HealthCheckId;
    label: string;
    /** Human-readable current value */
    current: string;
    /** null when the check is healthy */
    severity: HealthSeverity | null;
    /** Why the check is degraded, null when healthy */
    reason: string | null;
    /** Usual value the current one was compared to, null for absolute thresholds */
    reference: HealthReference | null;
}

/**
 * State of a degraded check carried over from the previous runs
 */
export interface ActiveIssue {
    severity: HealthSeverity;
    /** Reference pinned when the degradation started */
    reference: HealthReference | null;
}

export interface HealthAnalysisOptions {
    /**
     * Checks currently degraded. Their reference stays pinned, so that a long degradation does
     * not become the new normal, and they only recover past a small margin (hysteresis).
     */
    activeIssues?: Partial<Record<HealthCheckId, ActiveIssue>>;
    /** Events are detected on samples strictly newer than this date (default: the window start) */
    eventsAfter?: Date | null;
}

export interface HealthEvent {
    kind: HealthEventKind;
    /** Timestamp of the heartbeat that revealed the event */
    sampleAt: Date;
    message: string;
}

export interface HealthAnalysis {
    /** Results of the enabled checks that had enough data to be evaluated */
    results: HealthCheckResult[];
    /** Events revealed by the heartbeats newer than eventsAfter */
    events: HealthEvent[];
}

/**
 * Minimum number of samples in the analysis window to evaluate a numeric check
 */
export const MIN_WINDOW_SAMPLES = 3;

/**
 * Minimum number of samples in the baseline to evaluate a check relative to the baseline
 */
export const MIN_BASELINE_SAMPLES = 12;

/**
 * Margins a degraded value must go back past before the check recovers or improves
 */
export const HYSTERESIS = {
    dbm: 0.5,
    temperature: 2,
    diskPercent: 1,
    lineRatePercent: 2,
};

const SEVERITY_RANK: Record<HealthSeverity, number> = { warning: 1, critical: 2 };

type NumericColumn = {
    [K in keyof HealthSample]: HealthSample[K] extends number | null ? K : never;
}[keyof HealthSample];

/**
 * Median of a list of numbers (robust to isolated spikes), null for an empty list
 */
export function median(values: number[]): number | null {
    if (values.length === 0) {
        return null;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Severity of a value where higher is worse. While a level is active, the value has to go
 * back below its threshold minus the margin to leave it, which prevents flapping.
 */
export function severityFor(
    value: number,
    warning: number,
    critical: number,
    margin: number,
    active: HealthSeverity | null | undefined
): HealthSeverity | null {
    const activeRank = active ? SEVERITY_RANK[active] : 0;

    if (value >= critical - (activeRank >= SEVERITY_RANK.critical ? margin : 0)) {
        return 'critical';
    }
    if (value >= warning - (activeRank >= SEVERITY_RANK.warning ? margin : 0)) {
        return 'warning';
    }
    return null;
}

/**
 * Format a bit rate in bit/s with an adapted unit
 */
export function formatBitrate(bitsPerSecond: number): string {
    if (bitsPerSecond >= 1e9) {
        return `${(bitsPerSecond / 1e9).toFixed(2)} Gbit/s`;
    }
    if (bitsPerSecond >= 1e6) {
        return `${(bitsPerSecond / 1e6).toFixed(1)} Mbit/s`;
    }
    return `${(bitsPerSecond / 1e3).toFixed(0)} kbit/s`;
}

/**
 * Format a size in bytes with an adapted decimal unit
 */
export function formatBytes(bytes: number): string {
    if (bytes >= 1e12) {
        return `${(bytes / 1e12).toFixed(2)} TB`;
    }
    if (bytes >= 1e9) {
        return `${(bytes / 1e9).toFixed(1)} GB`;
    }
    return `${(bytes / 1e6).toFixed(0)} MB`;
}

function formatDbm(value: number): string {
    return `${value.toFixed(1)} dBm`;
}

function numericValues(samples: HealthSample[], column: NumericColumn): number[] {
    return samples
        .map((sample) => sample[column])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function baselineMedian(samples: HealthSample[], column: NumericColumn): number | null {
    const values = numericValues(samples, column);
    return values.length >= MIN_BASELINE_SAMPLES ? median(values) : null;
}

function windowMedian(samples: HealthSample[], column: NumericColumn): number | null {
    const values = numericValues(samples, column);
    return values.length >= MIN_WINDOW_SAMPLES ? median(values) : null;
}

function pinnedNumber(issue: ActiveIssue | undefined): number | null {
    return typeof issue?.reference === 'number' ? issue.reference : null;
}

function checkFiberRx(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig,
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_rx_dbm');
    if (current === null) {
        return null;
    }

    const { rxWarningDbm, rxCriticalDbm, dropDb } = config.fiber;
    const reference = pinnedNumber(active) ?? baselineMedian(baseline, 'sfp_pwr_rx_dbm');
    // Lower is worse for optical power: the opposite values are compared
    const absolute = severityFor(
        -current,
        -rxWarningDbm,
        -rxCriticalDbm,
        HYSTERESIS.dbm,
        active?.severity
    );
    const drop =
        reference === null
            ? null
            : severityFor(reference - current, dropDb, Infinity, HYSTERESIS.dbm, active?.severity);

    let reason: string | null = null;
    if (absolute !== null) {
        const threshold = absolute === 'critical' ? rxCriticalDbm : rxWarningDbm;
        reason = `${absolute} threshold: ${formatDbm(threshold)}`;
    } else if (drop !== null && reference !== null) {
        reason = `${(reference - current).toFixed(1)} dB below baseline (${formatDbm(reference)})`;
    }

    return {
        check: 'fiber_rx',
        label: 'Fiber RX power',
        current: formatDbm(current),
        severity: absolute ?? drop,
        reason,
        reference,
    };
}

function checkFiberTx(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig,
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_tx_dbm');
    const reference = pinnedNumber(active) ?? baselineMedian(baseline, 'sfp_pwr_tx_dbm');

    // TX power has no universal absolute threshold, only a drop relative to the baseline is checked
    if (current === null || reference === null) {
        return null;
    }

    const severity = severityFor(
        reference - current,
        config.fiber.dropDb,
        Infinity,
        HYSTERESIS.dbm,
        active?.severity
    );

    return {
        check: 'fiber_tx',
        label: 'Fiber TX power',
        current: formatDbm(current),
        severity,
        reason: severity
            ? `${(reference - current).toFixed(1)} dB below baseline (${formatDbm(reference)})`
            : null,
        reference,
    };
}

function checkLineRate(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig,
    direction: 'down' | 'up',
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    const column = direction === 'down' ? 'bandwidth_down' : 'bandwidth_up';
    const current = windowMedian(window, column);
    const reference = pinnedNumber(active) ?? baselineMedian(baseline, column);

    if (current === null || reference === null || reference <= 0) {
        return null;
    }

    const dropPercent = ((reference - current) / reference) * 100;
    const severity = severityFor(
        dropPercent,
        config.lineRate.dropPercent,
        Infinity,
        HYSTERESIS.lineRatePercent,
        active?.severity
    );

    return {
        check: direction === 'down' ? 'line_rate_down' : 'line_rate_up',
        label: direction === 'down' ? 'Line rate (down)' : 'Line rate (up)',
        current: formatBitrate(current),
        severity,
        reason: severity
            ? `${dropPercent.toFixed(0)}% below baseline (${formatBitrate(reference)})`
            : null,
        reference,
    };
}

/**
 * Most frequent media over the baseline (e.g. 'ftth'), null without enough samples
 */
function usualMedia(baseline: HealthSample[]): string | null {
    const counts = new Map<string, number>();
    for (const sample of baseline) {
        if (sample.media_state) {
            counts.set(sample.media_state, (counts.get(sample.media_state) ?? 0) + 1);
        }
    }

    let usual: string | null = null;
    let usualCount = 0;
    for (const [media, count] of counts) {
        if (count > usualCount) {
            usual = media;
            usualCount = count;
        }
    }

    return usualCount >= MIN_BASELINE_SAMPLES ? usual : null;
}

function checkMedia(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig,
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    let current: string | null = null;
    for (let i = window.length - 1; i >= 0 && current === null; i--) {
        current = window[i].media_state || null;
    }

    const pinned = typeof active?.reference === 'string' ? active.reference : null;
    const usual = pinned ?? usualMedia(baseline);
    if (current === null || usual === null) {
        return null;
    }

    const degraded = current !== usual;
    const period = pinned ? 'before the change' : `over the last ${config.baselineHours}h`;

    return {
        check: 'media',
        label: 'Connection media',
        current,
        severity: degraded ? 'warning' : null,
        reason: degraded ? `usual media ${period} is ${usual}` : null,
        reference: usual,
    };
}

function checkTemperature(
    window: HealthSample[],
    column: 'temp_cpu' | 'temp_switch' | 'disk_temp',
    check: HealthCheckId,
    label: string,
    thresholds: TemperatureConfig,
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    const current = windowMedian(window, column);
    if (current === null) {
        return null;
    }

    const severity = severityFor(
        current,
        thresholds.warning,
        thresholds.critical,
        HYSTERESIS.temperature,
        active?.severity
    );

    return {
        check,
        label,
        current: `${current.toFixed(0)}°C`,
        severity,
        reason: severity ? `${severity} threshold: ${thresholds[severity]}°C` : null,
        reference: null,
    };
}

function checkDiskSpace(
    window: HealthSample[],
    config: HealthChecksConfig,
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    // Disk usage changes slowly and is not noisy: the latest value is the most relevant
    const latest = [...window]
        .reverse()
        .find(
            (s) =>
                s.disk_used_bytes !== null && s.disk_total_bytes !== null && s.disk_total_bytes > 0
        );
    if (!latest || latest.disk_used_bytes === null || latest.disk_total_bytes === null) {
        return null;
    }

    const { warningPercent, criticalPercent } = config.diskSpace;
    const usedPercent = (latest.disk_used_bytes / latest.disk_total_bytes) * 100;
    const freeBytes = Math.max(latest.disk_total_bytes - latest.disk_used_bytes, 0);
    const severity = severityFor(
        usedPercent,
        warningPercent,
        criticalPercent,
        HYSTERESIS.diskPercent,
        active?.severity
    );
    const threshold = severity === 'critical' ? criticalPercent : warningPercent;

    return {
        check: 'disk_space',
        label: 'Disk space',
        current: `${usedPercent.toFixed(1)}% used (${formatBytes(freeBytes)} free)`,
        severity,
        reason: severity ? `${severity} threshold: ${threshold}%` : null,
        reference: null,
    };
}

function checkFan(
    window: HealthSample[],
    baseline: HealthSample[],
    active: ActiveIssue | undefined
): HealthCheckResult | null {
    const current = windowMedian(window, 'fan_rpm');

    // The usual speed only comes from the samples where the fan spins, so that a long stop does
    // not make the fan look absent. Boxes without enough such samples are not checked.
    const spinning = numericValues(baseline, 'fan_rpm').filter((rpm) => rpm > 0);
    const usual =
        pinnedNumber(active) ?? (spinning.length >= MIN_BASELINE_SAMPLES ? median(spinning) : null);

    if (current === null || usual === null) {
        return null;
    }

    const stopped = current === 0;

    return {
        check: 'fan',
        label: 'Fan',
        current: `${current.toFixed(0)} rpm`,
        severity: stopped ? 'critical' : null,
        reason: stopped ? `fan stopped (usually ${usual.toFixed(0)} rpm)` : null,
        reference: usual,
    };
}

/**
 * Detect Freebox reboots: the uptime counter going backwards between two consecutive heartbeats
 */
function detectReboots(samples: HealthSample[], eventsAfter: Date): HealthEvent[] {
    const events: HealthEvent[] = [];
    let previousUptime: number | null = null;

    for (const sample of samples) {
        if (sample.uptime === null) {
            continue;
        }

        if (
            previousUptime !== null &&
            sample.uptime < previousUptime &&
            sample.timestamp.getTime() > eventsAfter.getTime()
        ) {
            const bootAt = new Date(sample.timestamp.getTime() - sample.uptime * 1000);
            events.push({
                kind: 'reboot',
                sampleAt: sample.timestamp,
                message: `Freebox rebooted around ${bootAt.toISOString()}`,
            });
        }

        previousUptime = sample.uptime;
    }

    return events;
}

/**
 * Detect public IP address changes between two consecutive heartbeats reporting an address
 */
function detectIpChanges(
    samples: HealthSample[],
    eventsAfter: Date,
    column: 'ipv4' | 'ipv6'
): HealthEvent[] {
    const events: HealthEvent[] = [];
    let previous: string | null = null;

    for (const sample of samples) {
        const current = sample[column];
        if (!current) {
            continue;
        }

        if (
            previous !== null &&
            current !== previous &&
            sample.timestamp.getTime() > eventsAfter.getTime()
        ) {
            events.push({
                kind: column === 'ipv4' ? 'public_ipv4' : 'public_ipv6',
                sampleAt: sample.timestamp,
                message: `Public ${column === 'ipv4' ? 'IPv4' : 'IPv6'} changed from ${previous} to ${current}`,
            });
        }

        previous = current;
    }

    return events;
}

/**
 * Detect disk error counters increasing after eventsAfter, aggregated in one event.
 * Counters going backwards (reset by a reboot) are ignored.
 */
function detectDiskErrors(samples: HealthSample[], eventsAfter: Date): HealthEvent[] {
    const increases = { read: 0, write: 0 };
    const totals = { read: 0, write: 0 };
    let lastIncreaseAt: Date | null = null;

    for (const [direction, column] of [
        ['read', 'disk_read_errors'],
        ['write', 'disk_write_errors'],
    ] as const) {
        let previous: number | null = null;

        for (const sample of samples) {
            const current = sample[column];
            if (current === null) {
                continue;
            }

            if (
                previous !== null &&
                current > previous &&
                sample.timestamp.getTime() > eventsAfter.getTime()
            ) {
                increases[direction] += current - previous;
                totals[direction] = current;
                if (lastIncreaseAt === null || sample.timestamp > lastIncreaseAt) {
                    lastIncreaseAt = sample.timestamp;
                }
            }

            previous = current;
        }
    }

    if (lastIncreaseAt === null) {
        return [];
    }

    const parts = (['read', 'write'] as const)
        .filter((direction) => increases[direction] > 0)
        .map((direction) => `+${increases[direction]} ${direction} (total ${totals[direction]})`);

    return [
        {
            kind: 'disk_errors',
            sampleAt: lastIncreaseAt,
            message: `Disk errors increased: ${parts.join(', ')}`,
        },
    ];
}

/**
 * Analyze the Freebox health over the analysis window, compared to the preceding baseline
 * @param samples Heartbeats covering the baseline and the analysis window, ordered by timestamp
 * @param windowStart Start of the analysis window; older samples make up the baseline
 * @param config Enabled checks and their thresholds
 * @param options State carried over from the previous runs
 */
export function analyzeHealth(
    samples: HealthSample[],
    windowStart: Date,
    config: HealthChecksConfig,
    options: HealthAnalysisOptions = {}
): HealthAnalysis {
    const baseline = samples.filter((s) => s.timestamp.getTime() < windowStart.getTime());
    const window = samples.filter((s) => s.timestamp.getTime() >= windowStart.getTime());
    const active = options.activeIssues ?? {};
    const eventsAfter = options.eventsAfter ?? new Date(windowStart.getTime() - 1);

    const results: (HealthCheckResult | null)[] = [];
    const events: HealthEvent[] = [];

    if (config.fiber.enabled) {
        results.push(
            checkFiberRx(window, baseline, config, active.fiber_rx),
            checkFiberTx(window, baseline, config, active.fiber_tx)
        );
    }
    if (config.lineRate.enabled) {
        results.push(
            checkLineRate(window, baseline, config, 'down', active.line_rate_down),
            checkLineRate(window, baseline, config, 'up', active.line_rate_up)
        );
    }
    if (config.media.enabled) {
        results.push(checkMedia(window, baseline, config, active.media));
    }
    if (config.diskSpace.enabled) {
        results.push(checkDiskSpace(window, config, active.disk_space));
    }
    if (config.diskTemp.enabled) {
        results.push(
            checkTemperature(
                window,
                'disk_temp',
                'disk_temp',
                'Disk temperature',
                config.diskTemp,
                active.disk_temp
            )
        );
    }
    if (config.cpuTemp.enabled) {
        results.push(
            checkTemperature(
                window,
                'temp_cpu',
                'cpu_temp',
                'CPU temperature',
                config.cpuTemp,
                active.cpu_temp
            )
        );
    }
    if (config.switchTemp.enabled) {
        results.push(
            checkTemperature(
                window,
                'temp_switch',
                'switch_temp',
                'Switch temperature',
                config.switchTemp,
                active.switch_temp
            )
        );
    }
    if (config.fan.enabled) {
        results.push(checkFan(window, baseline, active.fan));
    }

    if (config.reboot.enabled) {
        events.push(...detectReboots(samples, eventsAfter));
    }
    if (config.publicIp.enabled) {
        events.push(
            ...detectIpChanges(samples, eventsAfter, 'ipv4'),
            ...detectIpChanges(samples, eventsAfter, 'ipv6')
        );
    }
    if (config.diskErrors.enabled) {
        events.push(...detectDiskErrors(samples, eventsAfter));
    }

    return {
        results: results.filter((result): result is HealthCheckResult => result !== null),
        events,
    };
}
