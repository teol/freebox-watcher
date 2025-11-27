import type { FastifyBaseLogger } from 'fastify';
import heartbeatService from './heartbeat.js';
import downtimeService from './downtime.js';
import { NotificationService } from './notification.js';

/**
 * DowntimeMonitor periodically checks for downtime conditions
 * and sends notifications via Telegram
 */
export class DowntimeMonitor {
    private intervalId: NodeJS.Timeout | null = null;
    private confirmedDowntimeIds = new Set<number>();
    private readonly checkIntervalMs: number;
    private readonly confirmationDelayMs: number;
    private readonly heartbeatTimeoutMs: number;
    private logger: FastifyBaseLogger;
    private notificationService: NotificationService;

    constructor(logger: FastifyBaseLogger, notificationService: NotificationService) {
        this.logger = logger;
        this.notificationService = notificationService;

        // Parse configuration from environment variables
        this.checkIntervalMs = Number.parseInt(process.env.DOWNTIME_CHECK_INTERVAL ?? '60000', 10);
        this.confirmationDelayMs = Number.parseInt(
            process.env.DOWNTIME_CONFIRMATION_DELAY ?? '1800000',
            10
        );
        this.heartbeatTimeoutMs = Number.parseInt(process.env.HEARTBEAT_TIMEOUT ?? '300000', 10);
    }

    /**
     * Start the downtime monitoring process
     */
    start(): void {
        if (this.intervalId) {
            this.logger.warn('DowntimeMonitor is already running');
            return;
        }

        this.logger.info(
            { checkIntervalSeconds: this.checkIntervalMs / 1000 },
            'Starting downtime monitor'
        );

        // Run immediately on start
        void this.checkDowntime();

        // Then run periodically
        this.intervalId = setInterval(() => {
            void this.checkDowntime();
        }, this.checkIntervalMs);
    }

    /**
     * Stop the downtime monitoring process
     */
    stop(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.logger.info('Downtime monitor stopped');
        }
    }

    /**
     * Check for downtime and handle notifications
     */
    private async checkDowntime(): Promise<void> {
        try {
            const shouldTrigger = await heartbeatService.shouldTriggerDowntime();
            const activeDowntime = await downtimeService.getActiveDowntimeEvent();

            // Case 1: No active downtime but should trigger
            if (shouldTrigger && !activeDowntime) {
                await this.createNewDowntime();
            }

            // Case 2: Active downtime that needs confirmation notification
            if (activeDowntime && !this.confirmedDowntimeIds.has(activeDowntime.id)) {
                await this.checkConfirmationNotification(activeDowntime);
            }
        } catch (error) {
            this.logger.error({ error }, 'Error in downtime check');
        }
    }

    /**
     * Create a new downtime event and send initial notification
     */
    private async createNewDowntime(): Promise<void> {
        const lastHeartbeat = await heartbeatService.getLastHeartbeat();

        if (!lastHeartbeat) {
            return;
        }

        const downtimeStartedAt = new Date(
            lastHeartbeat.timestamp.getTime() + this.heartbeatTimeoutMs
        );

        const downtimeId = await downtimeService.createDowntimeEvent(
            downtimeStartedAt,
            'Automatically detected downtime'
        );

        this.logger.info(
            { downtimeId, startedAt: downtimeStartedAt.toISOString() },
            'Created downtime event'
        );

        // Send initial notification
        if (this.notificationService.isEnabled()) {
            await this.notificationService.sendDowntimeAlert({
                downtimeId,
                startedAt: downtimeStartedAt,
            });
        }
    }

    /**
     * Check if a downtime needs a confirmation notification
     */
    private async checkConfirmationNotification(downtime: {
        id: number;
        started_at: Date;
    }): Promise<void> {
        const timeSinceStart = Date.now() - downtime.started_at.getTime();

        // If downtime has been active for more than 30 minutes, send confirmation
        if (timeSinceStart >= this.confirmationDelayMs) {
            this.confirmedDowntimeIds.add(downtime.id);

            this.logger.info(
                {
                    downtimeId: downtime.id,
                    durationMinutes: Math.floor(timeSinceStart / 60000),
                },
                'Sending confirmation notification for downtime'
            );

            if (this.notificationService.isEnabled()) {
                await this.notificationService.sendDowntimeConfirmedAlert({
                    downtimeId: downtime.id,
                    startedAt: downtime.started_at,
                });
            }
        }
    }

    /**
     * Mark a downtime as ended and clear from confirmed set
     */
    markDowntimeEnded(downtimeId: number): void {
        this.confirmedDowntimeIds.delete(downtimeId);
    }
}
