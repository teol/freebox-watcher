import os from 'os';
import cron from 'node-cron';
import * as cronParser from 'cron-parser';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { HeartbeatService, type HeartbeatRecord } from './heartbeat.js';

const DEFAULT_CRON_SCHEDULE = '0 5 * * *'; // Daily at 5:00 AM
const DISCORD_WEBHOOK_TIMEOUT_MS = 30_000;

export const CHART_WATERMARK = 'github.com/teol/freebox-watcher';
const CHART_WIDTH = 1200;
const CHART_HEIGHT = 500;

/**
 * Abstract base class for chart services that generate and send images to Discord.
 * Subclasses implement the chart-specific rendering and Discord message content.
 */
export abstract class BaseChartService {
    protected cronJob: cron.ScheduledTask | null = null;
    protected heartbeatService: HeartbeatService;
    protected discordWebhookUrl: string | null;
    protected cronSchedule: string;
    protected intervalHours: number;
    protected canvasRenderer: ChartJSNodeCanvas;
    private FormDataConstructor: typeof FormData;
    private BlobConstructor: typeof Blob;

    constructor(
        heartbeatService: HeartbeatService,
        discordWebhookUrl?: string,
        cronSchedule?: string
    ) {
        this.heartbeatService = heartbeatService;
        this.discordWebhookUrl = discordWebhookUrl || null;
        this.cronSchedule = cronSchedule || DEFAULT_CRON_SCHEDULE;
        this.intervalHours = BaseChartService.parseCronInterval(this.cronSchedule);

        // Fail-fast: Check for required Web APIs at startup
        if (!globalThis.FormData || !globalThis.Blob) {
            throw new Error(
                'FormData and/or Blob APIs are not available in this environment. This application requires Node.js >= 22.0.0.'
            );
        }
        this.FormDataConstructor = globalThis.FormData;
        this.BlobConstructor = globalThis.Blob;

        this.canvasRenderer = new ChartJSNodeCanvas({
            width: CHART_WIDTH,
            height: CHART_HEIGHT,
            backgroundColour: '#2c2f33',
        });
    }

    /**
     * Parses a CRON expression to determine the time interval in hours.
     * Uses cron-parser to support a wide range of CRON patterns.
     */
    public static parseCronInterval(cronExpression: string): number {
        const trimmedExpression = cronExpression?.trim();
        if (!trimmedExpression) {
            logger.warn('Empty CRON expression provided. Using default 24 hours interval.');
            return 24;
        }

        try {
            const interval = cronParser.CronExpressionParser.parse(trimmedExpression, {});
            const firstRun = interval.next().toDate();
            const secondRun = interval.next().toDate();
            const durationMs = secondRun.getTime() - firstRun.getTime();
            const durationHours = Math.round(durationMs / (1000 * 60 * 60));

            if (durationHours >= 24) {
                logger.info('Parsed CRON schedule: daily (24 hours)');
                return 24;
            }
            if (durationHours === 0) {
                logger.info('Parsed CRON schedule: every hour');
                return 1;
            }

            logger.info(`Parsed CRON schedule: every ${durationHours} hour(s)`);
            return durationHours;
        } catch (err) {
            logger.warn(
                `Invalid or unsupported CRON expression: "${trimmedExpression}". Using default 24 hours interval. Error: ${(err as Error).message}`
            );
            return 24;
        }
    }

    /**
     * Human-readable interval description for log and Discord contexts.
     */
    protected getIntervalDescription(context: 'log' | 'discord'): string {
        if (this.intervalHours === 24) {
            return context === 'log' ? 'daily' : 'Daily Report';
        }
        if (this.intervalHours === 1) {
            return context === 'log' ? 'every hour' : 'Hourly Report';
        }
        return context === 'log'
            ? `every ${this.intervalHours} hours`
            : `Report (Last ${this.intervalHours} Hours)`;
    }

    /** Human-readable name used in log messages, e.g. "network chart" or "devices chart". */
    protected abstract get serviceLabel(): string;

    /**
     * Build the Discord message content and embed color for this chart type.
     */
    protected abstract buildDiscordPayload(): { content: string; color: number };

    /**
     * Render the chart image and write it to a temporary file.
     * @returns The path to the temporary PNG file.
     */
    protected abstract createChartImage(
        heartbeats: HeartbeatRecord[],
        endDate: Date
    ): Promise<string>;

    /**
     * Starts the chart generation cron job with the configured schedule.
     */
    public start(): void {
        if (!this.discordWebhookUrl) {
            logger.info(
                `Discord webhook URL not configured, ${this.serviceLabel} service will not start`
            );
            return;
        }

        if (this.cronJob) {
            logger.warn(`${this.serviceLabel} service is already running`);
            return;
        }

        this.cronJob = cron.schedule(this.cronSchedule, async () => {
            await this.generateAndSendChart();
        });

        logger.info(
            `${this.serviceLabel} service started (schedule: ${this.cronSchedule}, ${this.getIntervalDescription('log')})`
        );
    }

    /**
     * Stops the chart generation cron job.
     */
    public stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info(`${this.serviceLabel} service stopped`);
        }
    }

    /**
     * Trigger chart generation and sending. Safe to call manually for testing.
     */
    public async generateAndSendChart(): Promise<void> {
        if (!this.discordWebhookUrl) {
            logger.warn(`Cannot generate ${this.serviceLabel}: Discord webhook URL not configured`);
            return;
        }

        let chartPath: string | undefined;
        try {
            logger.info(`Starting ${this.serviceLabel} generation...`);

            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - this.intervalHours * 60 * 60 * 1000);

            const heartbeats = await this.heartbeatService.getHeartbeatsInRange(startDate, endDate);

            if (heartbeats.length === 0) {
                logger.warn(
                    `No heartbeat data available for the last ${this.intervalHours} hour(s)`
                );
                return;
            }

            chartPath = await this.createChartImage(heartbeats, endDate);
            await this.sendToDiscord(chartPath);

            logger.info(`${this.serviceLabel} generated and sent successfully`);
        } catch (error) {
            logger.error({ error }, `Error generating or sending ${this.serviceLabel}`);
            // Do not re-throw to prevent crashing the scheduled task, allowing future runs.
        } finally {
            if (chartPath) {
                try {
                    await fs.unlink(chartPath);
                    logger.info(`Temporary file deleted: ${chartPath}`);
                } catch (unlinkError) {
                    logger.error(
                        { error: unlinkError },
                        `Failed to delete temporary file: ${chartPath}`
                    );
                }
            }
        }
    }

    /**
     * Write a rendered chart buffer to a uniquely named temporary PNG file.
     * @returns The path to the created file.
     */
    protected async writeTempFile(imageBuffer: Buffer, filePrefix: string): Promise<string> {
        const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
        await fs.mkdir(tempDir, { recursive: true });
        const chartPath = path.join(tempDir, `${filePrefix}-${globalThis.crypto.randomUUID()}.png`);
        await fs.writeFile(chartPath, imageBuffer);
        logger.info(`Chart image created: ${chartPath}`);
        return chartPath;
    }

    /**
     * Send a chart image to Discord via webhook.
     */
    private async sendToDiscord(imagePath: string): Promise<void> {
        if (!this.discordWebhookUrl) {
            throw new Error('Discord webhook URL is not configured');
        }

        const imageBuffer = await fs.readFile(imagePath);
        const filename = path.basename(imagePath);

        const formData = new this.FormDataConstructor();
        const blob = new this.BlobConstructor([imageBuffer], { type: 'image/png' });
        formData.append('file', blob, filename);

        const { content, color } = this.buildDiscordPayload();
        const payload = {
            content,
            embeds: [
                {
                    color,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Freebox Watcher' },
                },
            ],
        };
        formData.append('payload_json', JSON.stringify(payload));

        const abort = new AbortController();
        const abortTimer = setTimeout(() => abort.abort(), DISCORD_WEBHOOK_TIMEOUT_MS);

        let response: Response;
        try {
            response = await fetch(this.discordWebhookUrl, {
                method: 'POST',
                body: formData,
                signal: abort.signal,
            });
        } finally {
            clearTimeout(abortTimer);
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Failed to send ${this.serviceLabel} to Discord: ${response.status} ${response.statusText} - ${errorText}`
            );
        }

        logger.info(`${this.serviceLabel} successfully sent to Discord`);
    }
}
