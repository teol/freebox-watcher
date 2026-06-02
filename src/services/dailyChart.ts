import { ChartConfiguration } from 'chart.js';
import { BaseChartService, CHART_WATERMARK } from './baseChart.js';
import { HeartbeatService, type HeartbeatRecord } from './heartbeat.js';

/**
 * Service for generating and sending daily heartbeat rate charts to Discord
 */
export class DailyChartService extends BaseChartService {
    constructor(
        heartbeatService: HeartbeatService,
        discordWebhookUrl?: string,
        cronSchedule?: string
    ) {
        super(heartbeatService, discordWebhookUrl, cronSchedule);
    }

    protected get serviceLabel(): string {
        return 'network chart';
    }

    protected buildDiscordPayload(): { content: string; color: number } {
        return {
            content: `📊 **Freebox Network Rate ${this.getIntervalDescription('discord')}**`,
            color: 0x5865f2,
        };
    }

    /**
     * Creates a network rate chart image from heartbeat data.
     * Renders download and upload rates as lines over the reporting interval.
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

        const rateDownData = heartbeats.map((h) =>
            h.rate_down != null ? h.rate_down / 1000 : null
        ); // Convert to Kbps
        const rateUpData = heartbeats.map((h) => (h.rate_up != null ? h.rate_up / 1000 : null)); // Convert to Kbps

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

        const intervalLabel = this.intervalHours === 1 ? 'Hour' : `${this.intervalHours} Hours`;
        const dateLabel = endDate.toLocaleDateString('fr-FR');

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
                        text: `Freebox Network Rate - Last ${intervalLabel} (${dateLabel})`,
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
                        title: { display: true, text: `Rate (${unit})`, color: '#ffffff' },
                        ticks: { color: '#ffffff' },
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
        return this.writeTempFile(imageBuffer, 'heartbeat-chart');
    }
}
