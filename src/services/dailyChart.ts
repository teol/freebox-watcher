import os from 'os';
import cron from 'node-cron';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { HeartbeatService } from './heartbeat.js';

const WATERMARK = 'github.com/teol/freebox-watcher';
const DEFAULT_CRON_SCHEDULE = '0 5 * * *'; // Daily at 5:00 AM

/**
 * Service for generating and sending daily heartbeat rate charts to Discord
 */
export class DailyChartService {
    private cronJob: cron.ScheduledTask | null = null;
    private heartbeatService: HeartbeatService;
    private discordWebhookUrl: string | null;
    private cronSchedule: string;
    private intervalHours: number;
    private chartWidth = 1200;
    private chartHeight = 500;
    private FormDataConstructor!: typeof FormData;
    private BlobConstructor!: typeof Blob;

    constructor(
        heartbeatService: HeartbeatService,
        discordWebhookUrl?: string,
        cronSchedule?: string
    ) {
        this.heartbeatService = heartbeatService;
        this.discordWebhookUrl = discordWebhookUrl || null;
        this.cronSchedule = cronSchedule || DEFAULT_CRON_SCHEDULE;
        this.intervalHours = DailyChartService.parseCronInterval(this.cronSchedule);

        // Fail-fast: Check for required Web APIs at startup
        if (!globalThis.FormData || !globalThis.Blob) {
            throw new Error(
                'FormData and/or Blob APIs are not available in this environment. This application requires Node.js >= 22.0.0.'
            );
        }
        this.FormDataConstructor = globalThis.FormData;
        this.BlobConstructor = globalThis.Blob;
    }

    /**
     * Parses a CRON expression to determine the time interval in hours
     * Supports patterns like "0 5 * * *" (daily = 24h) and "0 *\/4 * * *" (every 4h)
     * @param cronExpression - The CRON expression to parse
     * @returns The interval in hours
     */
    public static parseCronInterval(cronExpression: string): number {
        const parts = cronExpression.trim().split(/\s+/);

        if (parts.length < 5) {
            logger.warn(
                `Invalid CRON expression: "${cronExpression}". Using default 24 hours interval.`
            );
            return 24;
        }

        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

        // Check for hourly patterns: "0 */N * * *" or "0 N * * *"
        const hourlyMatch = hour.match(/^\*\/(\d+)$/);
        if (hourlyMatch) {
            const hours = parseInt(hourlyMatch[1], 10);
            logger.info(`Parsed CRON schedule: every ${hours} hour(s)`);
            return hours;
        }

        // Check if it's a specific hour (daily pattern): "0 5 * * *"
        if (hour.match(/^\d+$/) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
            logger.info('Parsed CRON schedule: daily (24 hours)');
            return 24;
        }

        // Check for wildcard hour pattern: "0 * * * *" (every hour)
        if (hour === '*') {
            logger.info('Parsed CRON schedule: every hour');
            return 1;
        }

        // Default to 24 hours if pattern is not recognized
        logger.warn(
            `Unsupported CRON pattern: "${cronExpression}". Using default 24 hours interval.`
        );
        return 24;
    }

    /**
     * Starts the chart generation cron job with the configured schedule
     */
    public start(): void {
        if (!this.discordWebhookUrl) {
            logger.info('Discord webhook URL not configured, chart service will not start');
            return;
        }

        if (this.cronJob) {
            logger.warn('Chart service is already running');
            return;
        }

        this.cronJob = cron.schedule(this.cronSchedule, async () => {
            await this.generateAndSendChart();
        });

        const scheduleDescription =
            this.intervalHours === 24
                ? 'daily'
                : this.intervalHours === 1
                  ? 'every hour'
                  : `every ${this.intervalHours} hours`;

        logger.info(
            `Chart service started (schedule: ${this.cronSchedule}, ${scheduleDescription})`
        );
    }

    /**
     * Stops the daily chart generation cron job
     */
    public stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Daily chart service stopped');
        }
    }

    /**
     * Manually trigger chart generation and sending (useful for testing)
     */
    public async generateAndSendChart(): Promise<void> {
        if (!this.discordWebhookUrl) {
            logger.warn('Cannot generate chart: Discord webhook URL not configured');
            return;
        }

        let chartPath: string | undefined;
        try {
            logger.info('Starting chart generation...');

            // Get heartbeat data for the configured time interval
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - this.intervalHours * 60 * 60 * 1000);

            const heartbeats = await this.heartbeatService.getHeartbeatsInRange(startDate, endDate);

            if (heartbeats.length === 0) {
                logger.warn(
                    `No heartbeat data available for the last ${this.intervalHours} hour(s)`
                );
                return;
            }

            // Generate chart image
            chartPath = await this.createChartImage(heartbeats);

            // Send to Discord
            await this.sendToDiscord(chartPath);

            logger.info('Chart generated and sent successfully');
        } catch (error) {
            logger.error({ error }, 'Error generating or sending daily chart');
            // Do not re-throw to prevent crashing the scheduled task, allowing future runs.
            // The error has been logged for monitoring and debugging purposes.
        } finally {
            // Always clean up temporary file
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
     * Creates a chart image from heartbeat data
     */
    private async createChartImage(
        heartbeats: Array<{ timestamp: Date; rate_down: number | null; rate_up: number | null }>
    ): Promise<string> {
        const canvasRenderService = new ChartJSNodeCanvas({
            width: this.chartWidth,
            height: this.chartHeight,
            backgroundColour: '#2c2f33',
        });

        // Prepare data
        const labels = heartbeats.map((h) => {
            const date = new Date(h.timestamp);
            return date.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            });
        });

        const rateDownData = heartbeats.map((h) => (h.rate_down ? h.rate_down / 1000 : null)); // Convert to Kbps
        const rateUpData = heartbeats.map((h) => (h.rate_up ? h.rate_up / 1000 : null)); // Convert to Kbps

        // Determine appropriate unit and scale using reduce for better performance
        const maxRate = [...rateDownData, ...rateUpData].reduce<number>(
            (max, v) => (v !== null && v > max ? v : max),
            0
        );

        let unit = 'Kbps';
        let scale = 1;

        if (maxRate >= 1000000) {
            // Gbps
            unit = 'Gbps';
            scale = 1000000;
        } else if (maxRate >= 1000) {
            // Mbps
            unit = 'Mbps';
            scale = 1000;
        }

        const scaledRateDown = rateDownData.map((v) => (v !== null ? v / scale : null));
        const scaledRateUp = rateUpData.map((v) => (v !== null ? v / scale : null));

        const configuration: ChartConfiguration = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: `Download (${unit})`,
                        data: scaledRateDown,
                        borderColor: '#4bc0c0',
                        backgroundColor: 'rgba(75, 192, 192, 0)',
                        tension: 0.1,
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 2,
                    },
                    {
                        label: `Upload (${unit})`,
                        data: scaledRateUp,
                        borderColor: '#ff6384',
                        backgroundColor: 'rgba(255, 99, 132, 0)',
                        tension: 0.1,
                        fill: false,
                        pointRadius: 0,
                        borderWidth: 2,
                    },
                ],
            },
            options: {
                responsive: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Freebox Network Rate - Last ${this.intervalHours === 1 ? 'Hour' : `${this.intervalHours} Hours`} (${new Date().toLocaleDateString('en-US')})`,
                        color: 'rgba(255, 255, 255, 0.9)',
                        font: {
                            size: 22,
                            weight: 'bold',
                        },
                        padding: {
                            top: 10,
                            bottom: 20,
                        },
                    },
                    subtitle: {
                        display: true,
                        text: WATERMARK,
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: {
                            size: 11,
                            weight: 'normal',
                        },
                        padding: {
                            top: 5,
                            bottom: 5,
                        },
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: {
                            color: '#ffffff',
                        },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: `Rate (${unit})`,
                            color: '#ffffff',
                        },
                        ticks: {
                            color: '#ffffff',
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                        },
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time',
                            color: '#ffffff',
                        },
                        ticks: {
                            color: '#ffffff',
                            maxTicksLimit: 20,
                        },
                        grid: {
                            color: 'rgba(255, 255, 255, 0.1)',
                        },
                    },
                },
            },
        };

        const imageBuffer = await canvasRenderService.renderToBuffer(configuration);

        // Save to temporary file in OS temp directory
        const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
        await fs.mkdir(tempDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const chartPath = path.join(tempDir, `heartbeat-chart-${timestamp}.png`);

        await fs.writeFile(chartPath, imageBuffer);
        logger.info(`Chart image created: ${chartPath}`);

        return chartPath;
    }

    /**
     * Sends the chart image to Discord via webhook
     */
    private async sendToDiscord(imagePath: string): Promise<void> {
        if (!this.discordWebhookUrl) {
            throw new Error('Discord webhook URL is not configured');
        }

        const imageBuffer = await fs.readFile(imagePath);
        const filename = path.basename(imagePath);

        // Create form data for Discord webhook
        const formData = new this.FormDataConstructor();
        const blob = new this.BlobConstructor([imageBuffer], { type: 'image/png' });
        formData.append('file', blob, filename);

        const timeDescription =
            this.intervalHours === 24
                ? 'Daily Report'
                : this.intervalHours === 1
                  ? 'Hourly Report'
                  : `Report (Last ${this.intervalHours} Hours)`;

        const payload = {
            content: `📊 **Freebox Network Rate ${timeDescription}**`,
            embeds: [
                {
                    color: 0x5865f2,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Freebox Watcher',
                    },
                },
            ],
        };

        formData.append('payload_json', JSON.stringify(payload));

        const response = await fetch(this.discordWebhookUrl, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
                `Failed to send chart to Discord: ${response.status} ${response.statusText} - ${errorText}`
            );
        }

        logger.info('Chart successfully sent to Discord');
    }
}
