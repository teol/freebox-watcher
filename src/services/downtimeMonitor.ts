import heartbeatService from './heartbeat.js';
import downtimeService from './downtime.js';
import notificationService from './notification.js';

/**
 * DowntimeMonitor periodically checks for downtime conditions
 * and sends notifications via Telegram
 */
export class DowntimeMonitor {
    private intervalId: NodeJS.Timeout | null = null;
    private confirmedDowntimeIds = new Set<number>();
    private readonly checkIntervalMs: number;
    private readonly confirmationDelayMs = 30 * 60 * 1000; // 30 minutes

    constructor(checkIntervalMs = 60000) {
        this.checkIntervalMs = checkIntervalMs;
    }

    /**
     * Start the downtime monitoring process
     */
    start(): void {
        if (this.intervalId) {
            console.warn('DowntimeMonitor is already running');
            return;
        }

        console.log(`Starting downtime monitor (check interval: ${this.checkIntervalMs / 1000}s)`);

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
            console.log('Downtime monitor stopped');
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
            console.error('Error in downtime check:', error);
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

        const timeoutMs = Number.parseInt(process.env.HEARTBEAT_TIMEOUT ?? '300000', 10);
        const downtimeStartedAt = new Date(new Date(lastHeartbeat.timestamp).getTime() + timeoutMs);

        const downtimeId = await downtimeService.createDowntimeEvent(
            downtimeStartedAt,
            'Automatically detected downtime'
        );

        console.log(`Created downtime event #${downtimeId} at ${downtimeStartedAt.toISOString()}`);

        // Send initial notification
        if (notificationService.isEnabled()) {
            await notificationService.sendDowntimeAlert({
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
        const downtimeStartedAt = new Date(downtime.started_at);
        const timeSinceStart = Date.now() - downtimeStartedAt.getTime();

        // If downtime has been active for more than 30 minutes, send confirmation
        if (timeSinceStart >= this.confirmationDelayMs) {
            this.confirmedDowntimeIds.add(downtime.id);

            console.log(
                `Sending confirmation notification for downtime #${downtime.id} (duration: ${Math.floor(timeSinceStart / 60000)}min)`
            );

            if (notificationService.isEnabled()) {
                await notificationService.sendDowntimeConfirmedAlert({
                    downtimeId: downtime.id,
                    startedAt: downtimeStartedAt,
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

export default new DowntimeMonitor();
