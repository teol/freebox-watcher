import TelegramBot from 'node-telegram-bot-api';
import type { FastifyBaseLogger } from 'fastify';

export interface DowntimeNotificationData {
    downtimeId: number;
    startedAt: Date;
}

/**
 * NotificationService handles sending alerts via Telegram
 */
export class NotificationService {
    private bot: TelegramBot | null = null;
    private chatId: string | null = null;
    private enabled = false;
    private logger: FastifyBaseLogger;

    constructor(logger: FastifyBaseLogger) {
        this.logger = logger.child({ service: 'NotificationService' });
        this.initialize();
    }

    /**
     * Initialize the Telegram bot
     */
    private initialize(): void {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;

        if (!botToken || !chatId) {
            this.logger.warn(
                'Telegram notifications disabled: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured'
            );
            return;
        }

        try {
            this.bot = new TelegramBot(botToken, { polling: false });
            this.chatId = chatId;
            this.enabled = true;
            this.logger.info('Telegram notifications enabled');
        } catch (error) {
            this.logger.error({ error }, 'Failed to initialize Telegram bot');
        }
    }

    /**
     * Check if notifications are enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Send a message via Telegram
     */
    private async sendMessage(message: string): Promise<void> {
        if (!this.enabled || !this.bot || !this.chatId) {
            return;
        }

        try {
            await this.bot.sendMessage(this.chatId, message, {
                parse_mode: 'Markdown',
            });
            this.logger.debug({ chatId: this.chatId }, 'Telegram message sent');
        } catch (error) {
            this.logger.error({ error }, 'Failed to send Telegram message');
        }
    }

    /**
     * Send a startup notification when the service launches
     */
    async sendStartupNotification(): Promise<void> {
        await this.sendMessage('freebox-watcher is now running');
    }

    /**
     * Send a test notification for configuration validation
     */
    async sendTestNotification(): Promise<void> {
        await this.sendMessage('This is a test notification');
    }

    /**
     * Send initial downtime alert
     */
    async sendDowntimeAlert(
        data: DowntimeNotificationData,
        heartbeatTimeoutMs: number
    ): Promise<void> {
        const heartbeatTimeoutMinutes = Math.floor(heartbeatTimeoutMs / 60000);

        const message = [
            '🔴 *Downtime Detected*',
            '',
            `Started: ${data.startedAt.toISOString()}`,
            `ID: ${data.downtimeId}`,
            '',
            `No heartbeat received for ${heartbeatTimeoutMinutes} minutes.`,
        ].join('\n');

        await this.sendMessage(message);
    }

    /**
     * Send confirmed downtime alert (after 30 additional minutes)
     */
    async sendDowntimeConfirmedAlert(
        data: DowntimeNotificationData,
        confirmationDelayMs: number
    ): Promise<void> {
        const durationMinutes = Math.floor((Date.now() - data.startedAt.getTime()) / 60000);
        const confirmationDelayMinutes = Math.floor(confirmationDelayMs / 60000);

        const message = [
            '⚠️ *Downtime Confirmed*',
            '',
            `Started: ${data.startedAt.toISOString()}`,
            `Duration: ${durationMinutes} minutes`,
            `ID: ${data.downtimeId}`,
            '',
            `Service has been down for over ${confirmationDelayMinutes} minutes.`,
        ].join('\n');

        await this.sendMessage(message);
    }

    /**
     * Format duration in a human-readable way, adapting to the duration length
     */
    private formatDuration(durationSeconds: number): string {
        const days = Math.floor(durationSeconds / 86400);
        const hours = Math.floor((durationSeconds % 86400) / 3600);
        const minutes = Math.floor((durationSeconds % 3600) / 60);
        const seconds = durationSeconds % 60;

        const parts: string[] = [];

        if (days > 0) {
            parts.push(`${days}d`);
        }
        if (hours > 0) {
            parts.push(`${hours}h`);
        }
        if (minutes > 0) {
            parts.push(`${minutes}m`);
        }
        if (seconds > 0 || parts.length === 0) {
            parts.push(`${seconds}s`);
        }

        return parts.join(' ');
    }

    /**
     * Send recovery alert when service comes back online
     */
    async sendRecoveryAlert(downtimeId: number, startedAt: Date, endedAt: Date): Promise<void> {
        const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
        const durationText = this.formatDuration(durationSeconds);

        const message = [
            '✅ *Service Recovered*',
            '',
            `Downtime started: ${startedAt.toISOString()}`,
            `Recovered at: ${endedAt.toISOString()}`,
            `Total duration: ${durationText}`,
            `ID: ${downtimeId}`,
        ].join('\n');

        await this.sendMessage(message);
    }
}
