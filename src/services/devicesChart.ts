import { ChartConfiguration } from 'chart.js';
import { logger } from '../utils/logger.js';
import { BaseChartService, CHART_WATERMARK } from './baseChart.js';
import { HeartbeatService, type HeartbeatRecord } from './heartbeat.js';

/**
 * Service for generating and sending connected devices charts to Discord.
 * Must be explicitly enabled via the `enabled` constructor flag (DEVICES_CHART_ENABLED env var).
 */
export class DevicesChartService extends BaseChartService {
    private readonly enabled: boolean;

    constructor(
        heartbeatService: HeartbeatService,
        discordWebhookUrl?: string,
        cronSchedule?: string,
        enabled = false
    ) {
        super(heartbeatService, discordWebhookUrl, cronSchedule);
        this.enabled = enabled;
    }

    protected get serviceLabel(): string {
        return 'devices chart';
    }

    protected buildDiscordPayload(): { content: string; color: number } {
        return {
            content: `📱 **Freebox Connected Devices ${this.getIntervalDescription('discord')}**`,
            color: 0x7289da,
        };
    }

    /**
     * Starts the cron job. Skips start if the service is not explicitly enabled.
     */
    public override start(): void {
        if (!this.enabled) {
            logger.info('Devices chart service is disabled (DEVICES_CHART_ENABLED != true)');
            return;
        }
        super.start();
    }

    /**
     * Creates a connected devices chart image from heartbeat data.
     * Uses a filled line chart: total devices (blurple) and WiFi devices (gold) as overlapping areas.
     */
    protected async createChartImage(
        heartbeats: HeartbeatRecord[],
        endDate: Date
    ): Promise<string> {
        const labels = heartbeats.map((h) =>
            new Date(h.timestamp).toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
            })
        );

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
                        font: { size: 22, weight: 'bold' },
                        padding: { top: 10, bottom: 20 },
                    },
                    subtitle: {
                        display: true,
                        text: CHART_WATERMARK,
                        color: 'rgba(255, 255, 255, 0.4)',
                        font: { size: 11, weight: 'normal' },
                        padding: { top: 5, bottom: 5 },
                    },
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#ffffff' },
                    },
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Devices', color: '#ffffff' },
                        ticks: {
                            color: '#ffffff',
                            // Device counts are integers
                            stepSize: 1,
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    },
                    x: {
                        title: { display: true, text: 'Time', color: '#ffffff' },
                        ticks: { color: '#ffffff', maxTicksLimit: 20 },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' },
                    },
                },
            },
        };

        const imageBuffer = await this.canvasRenderer.renderToBuffer(configuration);
        return this.writeTempFile(imageBuffer, 'devices-chart');
    }
}
