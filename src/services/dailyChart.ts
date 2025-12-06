import cron from 'node-cron';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { HeartbeatService } from './heartbeat.js';

/**
 * Service for generating and sending daily heartbeat rate charts to Discord
 */
export class DailyChartService {
    private cronJob: cron.ScheduledTask | null = null;
    private heartbeatService: HeartbeatService;
    private discordWebhookUrl: string | null;
    private chartWidth = 1200;
    private chartHeight = 600;

    constructor(heartbeatService: HeartbeatService, discordWebhookUrl?: string) {
        this.heartbeatService = heartbeatService;
        this.discordWebhookUrl = discordWebhookUrl || null;
    }

    /**
     * Starts the daily chart generation cron job (runs at 5am daily)
     */
    public start(): void {
        if (!this.discordWebhookUrl) {
            logger.info('Discord webhook URL not configured, daily chart service will not start');
            return;
        }

        if (this.cronJob) {
            logger.warn('Daily chart service is already running');
            return;
        }

        // Run at 5:00 AM every day
        this.cronJob = cron.schedule('0 5 * * *', async () => {
            await this.generateAndSendChart();
        });

        logger.info('Daily chart service started (scheduled for 5:00 AM daily)');
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

        try {
            logger.info('Starting daily chart generation...');

            // Get heartbeat data from the last 24 hours
            const endDate = new Date();
            const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);

            const heartbeats = await this.heartbeatService.getHeartbeatsInRange(startDate, endDate);

            if (heartbeats.length === 0) {
                logger.warn('No heartbeat data available for the last 24 hours');
                return;
            }

            // Generate chart image
            const chartPath = await this.createChartImage(heartbeats);

            // Send to Discord
            await this.sendToDiscord(chartPath);

            // Delete the image file
            await fs.unlink(chartPath);
            logger.info(
                `Chart generated and sent successfully, temporary file deleted: ${chartPath}`
            );
        } catch (error) {
            logger.error({ error }, 'Error generating or sending daily chart');
            throw error;
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
            backgroundColour: 'white',
        });

        // Prepare data
        const labels = heartbeats.map((h) => {
            const date = new Date(h.timestamp);
            return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        });

        const rateDownData = heartbeats.map((h) => (h.rate_down ? h.rate_down / 1000 : null)); // Convert to Kbps
        const rateUpData = heartbeats.map((h) => (h.rate_up ? h.rate_up / 1000 : null)); // Convert to Kbps

        // Determine appropriate unit and scale
        const maxRate = Math.max(
            ...rateDownData.filter((v): v is number => v !== null),
            ...rateUpData.filter((v): v is number => v !== null)
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
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        tension: 0.1,
                        fill: true,
                    },
                    {
                        label: `Upload (${unit})`,
                        data: scaledRateUp,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1,
                        fill: true,
                    },
                ],
            },
            options: {
                responsive: false,
                plugins: {
                    title: {
                        display: true,
                        text: `Freebox Network Rate - Last 24 Hours (${new Date().toLocaleDateString('fr-FR')})`,
                        font: {
                            size: 18,
                        },
                    },
                    legend: {
                        display: true,
                        position: 'top',
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: `Rate (${unit})`,
                        },
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time',
                        },
                        ticks: {
                            maxTicksLimit: 20,
                        },
                    },
                },
            },
        };

        const imageBuffer = await canvasRenderService.renderToBuffer(configuration);

        // Save to temporary file
        const tempDir = path.join(process.cwd(), 'temp');
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
        const formData = new FormData();

        const blob = new Blob([imageBuffer], { type: 'image/png' });
        formData.append('file', blob, filename);

        const payload = {
            content: '📊 **Rapport quotidien - Débit Freebox (24 dernières heures)**',
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
