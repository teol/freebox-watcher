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
        this.logger = logger.child({ service: 'DowntimeMonitor' });
        this.notificationService = notificationService;

        // Parse configuration from environment variables
        this.checkIntervalMs = Number.parseInt(process.env.DOWNTIME_CHECK_INTERVAL ?? '60000', 10);
        this.confirmationDelayMs = Number.parseInt(
            process.env.DOWNTIME_CONFIRMATION_DELAY ?? '1800000',
            10
        );
        this.heartbeatTimeoutMs = Number.parseInt(process.env.HEARTBEAT_TIMEOUT ?? '300000', 10);

        if (
            Number.isNaN(this.checkIntervalMs) ||
            Number.isNaN(this.confirmationDelayMs) ||
            Number.isNaN(this.heartbeatTimeoutMs)
        ) {
            throw new Error(
                'Invalid monitoring configuration: One or more environment variables are not valid numbers.'
            );
        }
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

        // Then run periodically
        const runCheck = async () => {
            await this.checkDowntime();
            // If monitor has not been stopped, schedule the next check.
            if (this.intervalId) {
                this.intervalId = setTimeout(runCheck, this.checkIntervalMs);
            }
        };
        this.intervalId = setTimeout(runCheck, 0);
    }

    /**
     * Stop the downtime monitoring process
     */
    stop(): void {
        if (this.intervalId) {
            clearTimeout(this.intervalId);
            this.intervalId = null;
            this.logger.info('Downtime monitor stopped');
        }
    }

    /**
     * Check for downtime and handle notifications
     */
    private async checkDowntime(): Promise<void> {
        try {
            const activeDowntime = await downtimeService.getActiveDowntimeEvent();

            if (activeDowntime) {
                // If there's an active downtime, we only need to check for confirmation
                if (!this.confirmedDowntimeIds.has(activeDowntime.id)) {
                    await this.checkConfirmationNotification(activeDowntime);
                }
                return;
            }

            // If no active downtime, check if we should create one
            const lastHeartbeat = await heartbeatService.getLastHeartbeat();
            if (lastHeartbeat) {
                const timeSinceLast = Date.now() - lastHeartbeat.timestamp.getTime();
                if (timeSinceLast > this.heartbeatTimeoutMs) {
                    await this.createNewDowntime(lastHeartbeat);
                }
            }
        } catch (error) {
            this.logger.error({ error }, 'Error in downtime check');
        }
    }

    /**
     * Create a new downtime event and send initial notification
     */
    private async createNewDowntime(lastHeartbeat: { timestamp: Date }): Promise<void> {
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
            await this.notificationService.sendDowntimeAlert(
                {
                    downtimeId,
                    startedAt: downtimeStartedAt,
                },
                this.heartbeatTimeoutMs
            );
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
                await this.notificationService.sendDowntimeConfirmedAlert(
                    {
                        downtimeId: downtime.id,
                        startedAt: downtime.started_at,
                    },
                    this.confirmationDelayMs
                );
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
