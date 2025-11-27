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
        this.logger = logger;
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
     * Send initial downtime alert
     */
    async sendDowntimeAlert(data: DowntimeNotificationData): Promise<void> {
        const message = [
            '🔴 *Downtime Detected*',
            '',
            `Started: ${data.startedAt.toISOString()}`,
            `ID: ${data.downtimeId}`,
            '',
            `No heartbeat received for ${Number.parseInt(process.env.HEARTBEAT_TIMEOUT ?? '300000', 10) / 60000} minutes.`,
        ].join('\n');

        await this.sendMessage(message);
    }

    /**
     * Send confirmed downtime alert (after 30 additional minutes)
     */
    async sendDowntimeConfirmedAlert(data: DowntimeNotificationData): Promise<void> {
        const durationMinutes = Math.floor((Date.now() - data.startedAt.getTime()) / 60000);

        const message = [
            '⚠️ *Downtime Confirmed*',
            '',
            `Started: ${data.startedAt.toISOString()}`,
            `Duration: ${durationMinutes} minutes`,
            `ID: ${data.downtimeId}`,
            '',
            `Service has been down for over ${Number.parseInt(process.env.DOWNTIME_CONFIRMATION_DELAY ?? '1800000', 10) / 60000} minutes.`,
        ].join('\n');

        await this.sendMessage(message);
    }

    /**
     * Send recovery alert when service comes back online
     */
    async sendRecoveryAlert(downtimeId: number, startedAt: Date, endedAt: Date): Promise<void> {
        const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
        const durationMinutes = Math.floor(durationSeconds / 60);
        const remainingSeconds = durationSeconds % 60;

        const durationText =
            durationMinutes > 0
                ? `${durationMinutes}m ${remainingSeconds}s`
                : `${remainingSeconds}s`;

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
