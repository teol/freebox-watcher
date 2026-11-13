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

export interface HealthCheckResult {
    check: HealthCheckId;
    label: string;
    /** Human-readable current value */
    current: string;
    /** null when the check is healthy */
    severity: HealthSeverity | null;
    /** Why the check is degraded, null when healthy */
    reason: string | null;
}

export interface HealthEvent {
    kind: HealthEventKind;
    /** Timestamp of the heartbeat that revealed the event, used to notify each event once */
    sampleAt: Date;
    message: string;
}

export interface HealthAnalysis {
    /** Results of the enabled checks that had enough data to be evaluated */
    results: HealthCheckResult[];
    /** Events revealed by the heartbeats of the analysis window */
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

function checkFiberRx(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig
): HealthCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_rx_dbm');
    if (current === null) {
        return null;
    }

    const { rxCriticalDbm, rxWarningDbm, dropDb } = config.fiber;
    const reference = baselineMedian(baseline, 'sfp_pwr_rx_dbm');
    const result: HealthCheckResult = {
        check: 'fiber_rx',
        label: 'Fiber RX power',
        current: formatDbm(current),
        severity: null,
        reason: null,
    };

    if (current < rxCriticalDbm) {
        result.severity = 'critical';
        result.reason = `below critical threshold of ${formatDbm(rxCriticalDbm)}`;
    } else if (current < rxWarningDbm) {
        result.severity = 'warning';
        result.reason = `below warning threshold of ${formatDbm(rxWarningDbm)}`;
    } else if (reference !== null && reference - current >= dropDb) {
        result.severity = 'warning';
        result.reason = `${(reference - current).toFixed(1)} dB below ${config.baselineHours}h baseline (${formatDbm(reference)})`;
    }

    return result;
}

function checkFiberTx(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig
): HealthCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_tx_dbm');
    const reference = baselineMedian(baseline, 'sfp_pwr_tx_dbm');

    // TX power has no universal absolute threshold, only a drop relative to the baseline is checked
    if (current === null || reference === null) {
        return null;
    }

    const degraded = reference - current >= config.fiber.dropDb;

    return {
        check: 'fiber_tx',
        label: 'Fiber TX power',
        current: formatDbm(current),
        severity: degraded ? 'warning' : null,
        reason: degraded
            ? `${(reference - current).toFixed(1)} dB below ${config.baselineHours}h baseline (${formatDbm(reference)})`
            : null,
    };
}

function checkLineRate(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig,
    direction: 'down' | 'up'
): HealthCheckResult | null {
    const column = direction === 'down' ? 'bandwidth_down' : 'bandwidth_up';
    const current = windowMedian(window, column);
    const reference = baselineMedian(baseline, column);

    if (current === null || reference === null || reference <= 0) {
        return null;
    }

    const dropPercent = ((reference - current) / reference) * 100;
    const degraded = dropPercent >= config.lineRate.dropPercent;

    return {
        check: direction === 'down' ? 'line_rate_down' : 'line_rate_up',
        label: direction === 'down' ? 'Line rate (down)' : 'Line rate (up)',
        current: formatBitrate(current),
        severity: degraded ? 'warning' : null,
        reason: degraded
            ? `${dropPercent.toFixed(0)}% below ${config.baselineHours}h baseline (${formatBitrate(reference)})`
            : null,
    };
}

function checkMedia(
    window: HealthSample[],
    baseline: HealthSample[],
    config: HealthChecksConfig
): HealthCheckResult | null {
    let current: string | null = null;
    for (let i = window.length - 1; i >= 0 && current === null; i--) {
        current = window[i].media_state || null;
    }
    if (current === null) {
        return null;
    }

    // Most frequent media over the baseline (e.g. 'ftth'), the usual one
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

    if (usual === null || usualCount < MIN_BASELINE_SAMPLES) {
        return null;
    }

    const degraded = current !== usual;

    return {
        check: 'media',
        label: 'Connection media',
        current,
        severity: degraded ? 'warning' : null,
        reason: degraded ? `usual media over the last ${config.baselineHours}h is ${usual}` : null,
    };
}

function checkTemperature(
    window: HealthSample[],
    column: 'temp_cpu' | 'temp_switch' | 'disk_temp',
    check: HealthCheckId,
    label: string,
    thresholds: TemperatureConfig
): HealthCheckResult | null {
    const current = windowMedian(window, column);
    if (current === null) {
        return null;
    }

    const result: HealthCheckResult = {
        check,
        label,
        current: `${current.toFixed(0)}°C`,
        severity: null,
        reason: null,
    };

    if (current >= thresholds.critical) {
        result.severity = 'critical';
        result.reason = `at or above critical threshold of ${thresholds.critical}°C`;
    } else if (current >= thresholds.warning) {
        result.severity = 'warning';
        result.reason = `at or above warning threshold of ${thresholds.warning}°C`;
    }

    return result;
}

function checkDiskSpace(
    window: HealthSample[],
    config: HealthChecksConfig
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
    const result: HealthCheckResult = {
        check: 'disk_space',
        label: 'Disk space',
        current: `${usedPercent.toFixed(1)}% used (${formatBytes(freeBytes)} free)`,
        severity: null,
        reason: null,
    };

    if (usedPercent >= criticalPercent) {
        result.severity = 'critical';
        result.reason = `at or above critical threshold of ${criticalPercent}%`;
    } else if (usedPercent >= warningPercent) {
        result.severity = 'warning';
        result.reason = `at or above warning threshold of ${warningPercent}%`;
    }

    return result;
}

function checkFan(window: HealthSample[], baseline: HealthSample[]): HealthCheckResult | null {
    const current = windowMedian(window, 'fan_rpm');
    const reference = baselineMedian(baseline, 'fan_rpm');

    // Only a fan that usually spins and stopped is reported, the speed itself varies with load
    if (current === null || reference === null || reference <= 0) {
        return null;
    }

    const stopped = current === 0;

    return {
        check: 'fan',
        label: 'Fan',
        current: `${current.toFixed(0)} rpm`,
        severity: stopped ? 'critical' : null,
        reason: stopped ? `fan stopped (usually ${reference.toFixed(0)} rpm)` : null,
    };
}

/**
 * Detect Freebox reboots: the uptime counter going backwards between two consecutive heartbeats
 */
function detectReboots(samples: HealthSample[], windowStart: Date): HealthEvent[] {
    const events: HealthEvent[] = [];
    let previousUptime: number | null = null;

    for (const sample of samples) {
        if (sample.uptime === null) {
            continue;
        }

        if (
            previousUptime !== null &&
            sample.uptime < previousUptime &&
            sample.timestamp.getTime() >= windowStart.getTime()
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
    windowStart: Date,
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
            sample.timestamp.getTime() >= windowStart.getTime()
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
 * Detect disk error counters increasing within the analysis window, aggregated in one event.
 * Counters going backwards (reset by a reboot) are ignored.
 */
function detectDiskErrors(samples: HealthSample[], windowStart: Date): HealthEvent[] {
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
                sample.timestamp.getTime() >= windowStart.getTime()
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
 */
export function analyzeHealth(
    samples: HealthSample[],
    windowStart: Date,
    config: HealthChecksConfig
): HealthAnalysis {
    const baseline = samples.filter((s) => s.timestamp.getTime() < windowStart.getTime());
    const window = samples.filter((s) => s.timestamp.getTime() >= windowStart.getTime());

    const results: (HealthCheckResult | null)[] = [];
    const events: HealthEvent[] = [];

    if (config.fiber.enabled) {
        results.push(
            checkFiberRx(window, baseline, config),
            checkFiberTx(window, baseline, config)
        );
    }
    if (config.lineRate.enabled) {
        results.push(
            checkLineRate(window, baseline, config, 'down'),
            checkLineRate(window, baseline, config, 'up')
        );
    }
    if (config.media.enabled) {
        results.push(checkMedia(window, baseline, config));
    }
    if (config.diskSpace.enabled) {
        results.push(checkDiskSpace(window, config));
    }
    if (config.diskTemp.enabled) {
        results.push(
            checkTemperature(window, 'disk_temp', 'disk_temp', 'Disk temperature', config.diskTemp)
        );
    }
    if (config.cpuTemp.enabled) {
        results.push(
            checkTemperature(window, 'temp_cpu', 'cpu_temp', 'CPU temperature', config.cpuTemp)
        );
    }
    if (config.switchTemp.enabled) {
        results.push(
            checkTemperature(
                window,
                'temp_switch',
                'switch_temp',
                'Switch temperature',
                config.switchTemp
            )
        );
    }
    if (config.fan.enabled) {
        results.push(checkFan(window, baseline));
    }

    if (config.reboot.enabled) {
        events.push(...detectReboots(samples, windowStart));
    }
    if (config.publicIp.enabled) {
        events.push(
            ...detectIpChanges(samples, windowStart, 'ipv4'),
            ...detectIpChanges(samples, windowStart, 'ipv6')
        );
    }
    if (config.diskErrors.enabled) {
        events.push(...detectDiskErrors(samples, windowStart));
    }

    return {
        results: results.filter((result): result is HealthCheckResult => result !== null),
        events,
    };
}
