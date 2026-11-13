import type { HeartbeatsTable } from '../types/database.js';

/**
 * Heartbeat columns needed to analyze the connection quality
 */
export type QualitySample = Pick<
    HeartbeatsTable,
    | 'timestamp'
    | 'media_state'
    | 'bandwidth_down'
    | 'bandwidth_up'
    | 'sfp_pwr_rx_dbm'
    | 'sfp_pwr_tx_dbm'
    | 'uptime'
>;

export const QUALITY_SAMPLE_COLUMNS: (keyof QualitySample)[] = [
    'timestamp',
    'media_state',
    'bandwidth_down',
    'bandwidth_up',
    'sfp_pwr_rx_dbm',
    'sfp_pwr_tx_dbm',
    'uptime',
];

export type QualityCheckId =
    'sfp_rx' | 'sfp_tx' | 'bandwidth_down' | 'bandwidth_up' | 'media_state';

export type QualitySeverity = 'warning' | 'critical';

export interface QualityThresholds {
    /** Length of the baseline period preceding the analysis window */
    baselineHours: number;
    /** Fiber RX power below which a warning is raised */
    sfpRxWarningDbm: number;
    /** Fiber RX power below which a critical alert is raised */
    sfpRxCriticalDbm: number;
    /** Fiber RX/TX power drop (in dB) compared to the baseline that raises a warning */
    sfpDropDb: number;
    /** Line rate drop (in percent) compared to the baseline that raises a warning */
    bandwidthDropPercent: number;
}

export interface QualityCheckResult {
    check: QualityCheckId;
    label: string;
    /** Human-readable current value (median over the analysis window) */
    current: string;
    /** null when the check is healthy */
    severity: QualitySeverity | null;
    /** Why the check is degraded, null when healthy */
    reason: string | null;
}

export interface QualityAnalysis {
    /** Results of the checks that had enough data to be evaluated */
    results: QualityCheckResult[];
    /** Estimated boot times of the Freebox reboots detected within the analysis window */
    reboots: Date[];
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

function formatDbm(value: number): string {
    return `${value.toFixed(1)} dBm`;
}

function numericValues(samples: QualitySample[], column: keyof QualitySample): number[] {
    return samples
        .map((sample) => sample[column])
        .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
}

function baselineMedian(samples: QualitySample[], column: keyof QualitySample): number | null {
    const values = numericValues(samples, column);
    return values.length >= MIN_BASELINE_SAMPLES ? median(values) : null;
}

function windowMedian(samples: QualitySample[], column: keyof QualitySample): number | null {
    const values = numericValues(samples, column);
    return values.length >= MIN_WINDOW_SAMPLES ? median(values) : null;
}

function checkSfpRx(
    window: QualitySample[],
    baseline: QualitySample[],
    thresholds: QualityThresholds
): QualityCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_rx_dbm');
    if (current === null) {
        return null;
    }

    const reference = baselineMedian(baseline, 'sfp_pwr_rx_dbm');
    const result: QualityCheckResult = {
        check: 'sfp_rx',
        label: 'Fiber RX power',
        current: formatDbm(current),
        severity: null,
        reason: null,
    };

    if (current < thresholds.sfpRxCriticalDbm) {
        result.severity = 'critical';
        result.reason = `below critical threshold of ${formatDbm(thresholds.sfpRxCriticalDbm)}`;
    } else if (current < thresholds.sfpRxWarningDbm) {
        result.severity = 'warning';
        result.reason = `below warning threshold of ${formatDbm(thresholds.sfpRxWarningDbm)}`;
    } else if (reference !== null && reference - current >= thresholds.sfpDropDb) {
        result.severity = 'warning';
        result.reason = `${(reference - current).toFixed(1)} dB below ${thresholds.baselineHours}h baseline (${formatDbm(reference)})`;
    }

    return result;
}

function checkSfpTx(
    window: QualitySample[],
    baseline: QualitySample[],
    thresholds: QualityThresholds
): QualityCheckResult | null {
    const current = windowMedian(window, 'sfp_pwr_tx_dbm');
    const reference = baselineMedian(baseline, 'sfp_pwr_tx_dbm');

    // TX power has no universal absolute threshold, only a drop relative to the baseline is checked
    if (current === null || reference === null) {
        return null;
    }

    const degraded = reference - current >= thresholds.sfpDropDb;

    return {
        check: 'sfp_tx',
        label: 'Fiber TX power',
        current: formatDbm(current),
        severity: degraded ? 'warning' : null,
        reason: degraded
            ? `${(reference - current).toFixed(1)} dB below ${thresholds.baselineHours}h baseline (${formatDbm(reference)})`
            : null,
    };
}

function checkBandwidth(
    window: QualitySample[],
    baseline: QualitySample[],
    thresholds: QualityThresholds,
    direction: 'down' | 'up'
): QualityCheckResult | null {
    const column = direction === 'down' ? 'bandwidth_down' : 'bandwidth_up';
    const current = windowMedian(window, column);
    const reference = baselineMedian(baseline, column);

    if (current === null || reference === null || reference <= 0) {
        return null;
    }

    const dropPercent = ((reference - current) / reference) * 100;
    const degraded = dropPercent >= thresholds.bandwidthDropPercent;

    return {
        check: direction === 'down' ? 'bandwidth_down' : 'bandwidth_up',
        label: direction === 'down' ? 'Line rate (down)' : 'Line rate (up)',
        current: formatBitrate(current),
        severity: degraded ? 'warning' : null,
        reason: degraded
            ? `${dropPercent.toFixed(0)}% below ${thresholds.baselineHours}h baseline (${formatBitrate(reference)})`
            : null,
    };
}

function checkMediaState(
    window: QualitySample[],
    baseline: QualitySample[],
    thresholds: QualityThresholds
): QualityCheckResult | null {
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
        check: 'media_state',
        label: 'Connection media',
        current,
        severity: degraded ? 'warning' : null,
        reason: degraded
            ? `usual media over the last ${thresholds.baselineHours}h is ${usual}`
            : null,
    };
}

/**
 * Detect Freebox reboots: the uptime counter going backwards between two consecutive heartbeats
 * @returns The estimated boot times of the reboots reported by heartbeats received since windowStart
 */
function detectReboots(samples: QualitySample[], windowStart: Date): Date[] {
    const reboots: Date[] = [];
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
            reboots.push(new Date(sample.timestamp.getTime() - sample.uptime * 1000));
        }

        previousUptime = sample.uptime;
    }

    return reboots;
}

/**
 * Analyze the connection quality over the analysis window, compared to the preceding baseline
 * @param samples Heartbeats covering the baseline and the analysis window, ordered by timestamp
 * @param windowStart Start of the analysis window; older samples make up the baseline
 * @param thresholds Alert thresholds
 */
export function analyzeConnectionQuality(
    samples: QualitySample[],
    windowStart: Date,
    thresholds: QualityThresholds
): QualityAnalysis {
    const baseline = samples.filter((s) => s.timestamp.getTime() < windowStart.getTime());
    const window = samples.filter((s) => s.timestamp.getTime() >= windowStart.getTime());

    const results = [
        checkSfpRx(window, baseline, thresholds),
        checkSfpTx(window, baseline, thresholds),
        checkBandwidth(window, baseline, thresholds, 'down'),
        checkBandwidth(window, baseline, thresholds, 'up'),
        checkMediaState(window, baseline, thresholds),
    ].filter((result): result is QualityCheckResult => result !== null);

    return { results, reboots: detectReboots(samples, windowStart) };
}
