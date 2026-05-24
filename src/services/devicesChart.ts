import os from 'os';
import cron from 'node-cron';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { HeartbeatService } from './heartbeat.js';
import { DailyChartService } from './dailyChart.js';

const WATERMARK = 'github.com/teol/freebox-watcher';
const DEFAULT_CRON_SCHEDULE = '0 5 * * *'; // Daily at 5:00 AM
const DISCORD_WEBHOOK_TIMEOUT_MS = 30_000;

/**
 * Service for generating and sending connected devices charts to Discord
 */
export class DevicesChartService {
    private cronJob: cron.ScheduledTask | null = null;
    private heartbeatService: HeartbeatService;
    private discordWebhookUrl: string | null;
    private cronSchedule: string;
    private intervalHours: number;
    private enabled: boolean;
    private chartWidth = 1200;
    private chartHeight = 500;
    private canvasRenderer: ChartJSNodeCanvas;
    private FormDataConstructor!: typeof FormData;
    private BlobConstructor!: typeof Blob;

    constructor(
        heartbeatService: HeartbeatService,
        discordWebhookUrl?: string,
        cronSchedule?: string,
        enabled = false
    ) {
        this.heartbeatService = heartbeatService;
        this.discordWebhookUrl = discordWebhookUrl || null;
        this.cronSchedule = cronSchedule || DEFAULT_CRON_SCHEDULE;
        this.intervalHours = DailyChartService.parseCronInterval(this.cronSchedule);
        this.enabled = enabled;

        // Fail-fast: Check for required Web APIs at startup
        if (!globalThis.FormData || !globalThis.Blob) {
            throw new Error(
                'FormData and/or Blob APIs are not available in this environment. This application requires Node.js >= 22.0.0.'
            );
        }
        this.FormDataConstructor = globalThis.FormData;
        this.BlobConstructor = globalThis.Blob;

        this.canvasRenderer = new ChartJSNodeCanvas({
            width: this.chartWidth,
            height: this.chartHeight,
            backgroundColour: '#2c2f33',
        });
    }

    /**
     * Starts the chart generation cron job
     */
    public start(): void {
        if (!this.enabled) {
            logger.info('Devices chart service is disabled (DEVICES_CHART_ENABLED != true)');
            return;
        }

        if (!this.discordWebhookUrl) {
            logger.info('Discord webhook URL not configured, devices chart service will not start');
            return;
        }

        if (this.cronJob) {
            logger.warn('Devices chart service is already running');
            return;
        }

        this.cronJob = cron.schedule(this.cronSchedule, async () => {
            await this.generateAndSendChart();
        });

        const intervalLabel =
            this.intervalHours === 24
                ? 'daily'
                : this.intervalHours === 1
                  ? 'every hour'
                  : `every ${this.intervalHours} hours`;

        logger.info(
            `Devices chart service started (schedule: ${this.cronSchedule}, ${intervalLabel})`
        );
    }

    /**
     * Stops the chart generation cron job
     */
    public stop(): void {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
            logger.info('Devices chart service stopped');
        }
    }

    /**
     * Manually trigger chart generation and sending
     */
    public async generateAndSendChart(): Promise<void> {
        if (!this.discordWebhookUrl) {
            logger.warn('Cannot generate devices chart: Discord webhook URL not configured');
            return;
        }

        let chartPath: string | undefined;
        try {
            logger.info('Starting devices chart generation...');

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

            logger.info('Devices chart generated and sent successfully');
        } catch (error) {
            logger.error({ error }, 'Error generating or sending devices chart');
            // Do not re-throw to prevent crashing the scheduled task.
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
     * Creates a connected devices chart image from heartbeat data.
     * Uses a filled line chart: total devices (blurple) and WiFi devices (gold) as overlapping areas.
     */
    private async createChartImage(
        heartbeats: Array<{
            timestamp: Date;
            connected_devices_total: number | null;
            connected_devices_wifi: number | null;
        }>,
        endDate: Date
    ): Promise<string> {
        const labels = heartbeats.map((h) => {
            const date = new Date(h.timestamp);
            return date.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            });
        });

        const totalData = heartbeats.map((h) => h.connected_devices_total ?? null);
        const wifiData = heartbeats.map((h) => h.connected_devices_wifi ?? null);

        const intervalLabel = this.intervalHours === 1 ? 'Hour' : `${this.intervalHours} Hours`;
        const dateLabel = endDate.toLocaleDateString('fr-FR');

        const configuration: ChartConfiguration = {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Total Devices',
                        data: totalData,
                        borderColor: '#7289da',
                        backgroundColor: 'rgba(114, 137, 218, 0.35)',
                        tension: 0.3,
                        fill: true,
                        pointRadius: 0,
                        borderWidth: 2,
                    },
                    {
                        label: 'WiFi Devices',
                        data: wifiData,
                        borderColor: '#faa61a',
                        backgroundColor: 'rgba(250, 166, 26, 0.35)',
                        tension: 0.3,
                        fill: true,
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
                        text: `Freebox Connected Devices - Last ${intervalLabel} (${dateLabel})`,
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
                            text: 'Devices',
                            color: '#ffffff',
                        },
                        ticks: {
                            color: '#ffffff',
                            // Device counts are integers
                            stepSize: 1,
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

        const imageBuffer = await this.canvasRenderer.renderToBuffer(configuration);

        const tempDir = path.join(os.tmpdir(), 'freebox-watcher');
        await fs.mkdir(tempDir, { recursive: true });

        const chartPath = path.join(tempDir, `devices-chart-${globalThis.crypto.randomUUID()}.png`);

        await fs.writeFile(chartPath, imageBuffer);
        logger.info(`Devices chart image created: ${chartPath}`);

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

        const formData = new this.FormDataConstructor();
        const blob = new this.BlobConstructor([imageBuffer], { type: 'image/png' });
        formData.append('file', blob, filename);

        const intervalLabel =
            this.intervalHours === 24
                ? 'Daily Report'
                : this.intervalHours === 1
                  ? 'Hourly Report'
                  : `Report (Last ${this.intervalHours} Hours)`;

        const payload = {
            content: `📱 **Freebox Connected Devices ${intervalLabel}**`,
            embeds: [
                {
                    color: 0x7289da,
                    timestamp: new Date().toISOString(),
                    footer: {
                        text: 'Freebox Watcher',
                    },
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
                `Failed to send devices chart to Discord: ${response.status} ${response.statusText} - ${errorText}`
            );
        }

        logger.info('Devices chart successfully sent to Discord');
    }
}
