import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import heartbeatService from './heartbeat.js';

interface RatePoint {
    timestamp: Date;
    rateDown: number | null;
    rateUp: number | null;
}

interface ScaledPoint {
    timestamp: Date;
    rateDown: number | null;
    rateUp: number | null;
}

interface RateUnit {
    label: string;
    divisor: number;
}

/**
 * HeartbeatReportService schedules and generates a daily rate graph
 */
export class HeartbeatReportService {
    private timer: NodeJS.Timeout | null = null;
    private readonly logger: FastifyBaseLogger;
    private readonly webhookUrl: string | null;
    private readonly outputDir: string;

    constructor(
        logger: FastifyBaseLogger,
        outputDir = path.join(process.cwd(), 'logs', 'reports')
    ) {
        this.logger = logger.child({ service: 'HeartbeatReportService' });
        this.webhookUrl = process.env.DISCORD_WEBHOOK_URL ?? null;
        this.outputDir = outputDir;
    }

    /**
     * Start scheduling the daily report at 5 AM server time
     */
    start(): void {
        if (!this.webhookUrl) {
            this.logger.info('Discord webhook not configured; heartbeat rate reports disabled');
            return;
        }

        this.scheduleNextRun();
    }

    /**
     * Stop the scheduled task
     */
    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            this.logger.info('Heartbeat report scheduling stopped');
        }
    }

    /**
     * Public method to generate and send the report immediately
     */
    async runReport(): Promise<void> {
        if (!this.webhookUrl) {
            this.logger.warn('Heartbeat rate report skipped: webhook not configured');
            return;
        }

        const ratePoints = await this.getRatePoints();

        if (ratePoints.length === 0) {
            this.logger.warn('Heartbeat rate report skipped: no rate data available');
            return;
        }

        const maxRate = this.getMaxRate(ratePoints);
        const { label, divisor } = this.getRateUnit(maxRate);
        const scaledPoints = this.scaleRates(ratePoints, divisor);

        const svgContent = this.buildSvgGraph(scaledPoints, label, maxRate / divisor);
        const filePath = await this.saveReport(svgContent);

        try {
            await this.sendToDiscord(filePath, label);
            this.logger.info({ unit: label }, 'Heartbeat rate report sent to Discord');
        } catch (error) {
            this.logger.error({ error }, 'Failed to send heartbeat rate report');
        } finally {
            await this.deleteReport(filePath);
        }
    }

    private scheduleNextRun(): void {
        const delayMs = this.getDelayToNextRun();
        this.logger.info({ delayMs }, 'Scheduling next heartbeat rate report');

        this.timer = setTimeout(async () => {
            try {
                await this.runReport();
            } catch (error) {
                this.logger.error({ error }, 'Error during scheduled heartbeat rate report');
            } finally {
                // If stop() was called during execution, avoid scheduling again
                if (this.timer) {
                    this.scheduleNextRun();
                }
            }
        }, delayMs);
    }

    private getDelayToNextRun(): number {
        const now = new Date();
        const nextRun = new Date(now);
        nextRun.setHours(5, 0, 0, 0);

        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        return nextRun.getTime() - now.getTime();
    }

    private async getRatePoints(): Promise<RatePoint[]> {
        const heartbeats = await heartbeatService.getAllHeartbeats();

        return heartbeats
            .map((heartbeat) => ({
                timestamp: heartbeat.timestamp,
                rateDown: heartbeat.rate_down,
                rateUp: heartbeat.rate_up,
            }))
            .filter((entry) => entry.rateDown !== null || entry.rateUp !== null);
    }

    private getMaxRate(points: RatePoint[]): number {
        const maxDown = Math.max(...points.map((point) => point.rateDown ?? 0));
        const maxUp = Math.max(...points.map((point) => point.rateUp ?? 0));

        return Math.max(maxDown, maxUp, 1);
    }

    private getRateUnit(maxRate: number): RateUnit {
        if (maxRate >= 1_000_000_000) {
            return { label: 'Gbps', divisor: 1_000_000_000 };
        }

        if (maxRate >= 1_000_000) {
            return { label: 'Mbps', divisor: 1_000_000 };
        }

        if (maxRate >= 1_000) {
            return { label: 'Kbps', divisor: 1_000 };
        }

        return { label: 'bps', divisor: 1 };
    }

    private scaleRates(points: RatePoint[], divisor: number): ScaledPoint[] {
        return points.map((point) => ({
            timestamp: point.timestamp,
            rateDown: point.rateDown !== null ? point.rateDown / divisor : null,
            rateUp: point.rateUp !== null ? point.rateUp / divisor : null,
        }));
    }

    private buildSvgGraph(points: ScaledPoint[], unitLabel: string, maxValue: number): string {
        const width = 1200;
        const height = 630;
        const margin = { top: 60, right: 40, bottom: 80, left: 90 };
        const plotWidth = width - margin.left - margin.right;
        const plotHeight = height - margin.top - margin.bottom;

        const timestamps = points.map((point) => point.timestamp.getTime());
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        const timeRange = maxTime - minTime || 1;

        const yMax = Math.max(
            ...points.map((point) => Math.max(point.rateDown ?? 0, point.rateUp ?? 0, 0)),
            1
        );
        const yTicks = [0, yMax / 4, yMax / 2, (3 * yMax) / 4, yMax];

        const scaleX = (timestamp: number) =>
            margin.left + ((timestamp - minTime) / timeRange) * plotWidth;
        const scaleY = (value: number) => margin.top + (1 - value / yMax) * plotHeight;

        const buildPath = (values: Array<number | null>): string => {
            const segments: string[] = [];
            values.forEach((value, index) => {
                if (value === null) {
                    return;
                }

                const x = scaleX(timestamps[index]);
                const y = scaleY(value);
                segments.push(
                    `${segments.length === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
                );
            });
            return segments.join(' ');
        };

        const downPath = buildPath(points.map((point) => point.rateDown));
        const upPath = buildPath(points.map((point) => point.rateUp));

        const labels = this.buildTimeLabels(points.map((point) => point.timestamp));

        return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <style>
        text { font-family: Arial, sans-serif; fill: #1f2937; }
        .axis { stroke: #1f2937; stroke-width: 2; }
        .grid { stroke: #e5e7eb; stroke-width: 1; }
        .down { fill: none; stroke: #ef4444; stroke-width: 3; }
        .up { fill: none; stroke: #10b981; stroke-width: 3; }
        .legend { font-size: 18px; }
    </style>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" />
    <text x="${width / 2}" y="32" text-anchor="middle" font-size="24" font-weight="bold">Heartbeat rate history (${unitLabel})</text>
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis" />
    <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis" />
    ${yTicks
        .map((tick) => {
            const y = scaleY(tick);
            return `
    <line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${width - margin.right}" y2="${y.toFixed(2)}" class="grid" />
    <text x="${margin.left - 12}" y="${(y + 6).toFixed(2)}" text-anchor="end" font-size="16">${tick.toFixed(2)}</text>`;
        })
        .join('')}
    ${labels
        .map((label) => {
            const x = scaleX(label.timestamp.getTime());
            return `
    <line x1="${x.toFixed(2)}" y1="${height - margin.bottom}" x2="${x.toFixed(2)}" y2="${margin.top}" class="grid" />
    <text x="${x.toFixed(2)}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="16">${label.text}</text>`;
        })
        .join('')}
    ${downPath ? `<path d="${downPath}" class="down" />` : ''}
    ${upPath ? `<path d="${upPath}" class="up" />` : ''}
    <circle cx="${margin.left}" cy="${margin.top}" r="0" fill="transparent" aria-label="max ${maxValue.toFixed(2)} ${unitLabel}" />
    <rect x="${width - 260}" y="${margin.top - 40}" width="220" height="60" fill="#f9fafb" stroke="#d1d5db" stroke-width="1" rx="8" />
    <line x1="${width - 240}" y1="${margin.top - 20}" x2="${width - 220}" y2="${margin.top - 20}" class="down" />
    <text x="${width - 210}" y="${margin.top - 15}" class="legend">Download rate</text>
    <line x1="${width - 240}" y1="${margin.top + 10}" x2="${width - 220}" y2="${margin.top + 10}" class="up" />
    <text x="${width - 210}" y="${margin.top + 15}" class="legend">Upload rate</text>
</svg>`;
    }

    private buildTimeLabels(timestamps: Date[]): Array<{ timestamp: Date; text: string }> {
        if (timestamps.length === 0) {
            return [];
        }

        const labelCount = Math.min(5, timestamps.length);
        const step = Math.max(1, Math.floor((timestamps.length - 1) / (labelCount - 1)));
        const formatter = new Intl.DateTimeFormat('en-GB', {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });

        const labels: Array<{ timestamp: Date; text: string }> = [];
        for (let index = 0; index < timestamps.length; index += step) {
            const timestamp = timestamps[index];
            labels.push({
                timestamp,
                text: formatter.format(timestamp),
            });
        }

        if (
            labels[labels.length - 1].timestamp.getTime() !==
            timestamps[timestamps.length - 1].getTime()
        ) {
            labels[labels.length - 1] = {
                timestamp: timestamps[timestamps.length - 1],
                text: formatter.format(timestamps[timestamps.length - 1]),
            };
        }

        return labels;
    }

    private async saveReport(svgContent: string): Promise<string> {
        await fs.mkdir(this.outputDir, { recursive: true });
        const filePath = path.join(this.outputDir, `heartbeat-rate-report-${Date.now()}.svg`);
        await fs.writeFile(filePath, svgContent, 'utf-8');
        return filePath;
    }

    private async sendToDiscord(filePath: string, unitLabel: string): Promise<void> {
        if (!this.webhookUrl) {
            return;
        }

        const buffer = await fs.readFile(filePath);
        const file = new File([buffer], path.basename(filePath), { type: 'image/svg+xml' });
        const formData = new FormData();
        formData.append(
            'payload_json',
            JSON.stringify({ content: `📊 Daily heartbeat rate report (${unitLabel})` })
        );
        formData.append('file', file);

        const response = await fetch(this.webhookUrl, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Discord webhook responded with status ${response.status}: ${errorText}`
            );
        }
    }

    private async deleteReport(filePath: string): Promise<void> {
        try {
            await fs.rm(filePath, { force: true });
        } catch (error) {
            this.logger.error({ error, filePath }, 'Failed to delete heartbeat report file');
        }
    }
}

export default HeartbeatReportService;
