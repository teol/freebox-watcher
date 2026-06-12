import type { FastifyBaseLogger } from 'fastify';
import { NotificationService } from './notification.js';

const DEFAULT_FREE_PERCENT_THRESHOLD = 10;
const DEFAULT_COOLDOWN_MS = 3_600_000;

export class DiskAlertService {
    private readonly enabled: boolean;
    private readonly freePercentThreshold: number;
    private readonly cooldownMs: number;
    private lastAlertSentAt: number | null = null;
    private logger: FastifyBaseLogger;
    private notificationService: NotificationService;

    constructor(logger: FastifyBaseLogger, notificationService: NotificationService) {
        this.logger = logger.child({ service: 'DiskAlertService' });
        this.notificationService = notificationService;

        this.enabled = process.env.DISK_ALERT_ENABLED === 'true';

        const parsedThreshold = Number.parseFloat(
            process.env.DISK_ALERT_FREE_PERCENT_THRESHOLD ?? String(DEFAULT_FREE_PERCENT_THRESHOLD)
        );
        this.freePercentThreshold = Number.isNaN(parsedThreshold)
            ? DEFAULT_FREE_PERCENT_THRESHOLD
            : parsedThreshold;

        const parsedCooldown = Number.parseInt(
            process.env.DISK_ALERT_COOLDOWN ?? String(DEFAULT_COOLDOWN_MS),
            10
        );
        this.cooldownMs = Number.isNaN(parsedCooldown) ? DEFAULT_COOLDOWN_MS : parsedCooldown;

        if (this.enabled) {
            this.logger.info(
                {
                    freePercentThreshold: this.freePercentThreshold,
                    cooldownMs: this.cooldownMs,
                },
                'Disk space alerts enabled'
            );
        }
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    async checkAndAlert(diskFreeBytes: number, diskTotalBytes: number): Promise<void> {
        if (!this.enabled || !this.notificationService.isEnabled()) {
            return;
        }

        if (diskTotalBytes <= 0) {
            return;
        }

        const freePercent = (diskFreeBytes / diskTotalBytes) * 100;

        if (freePercent >= this.freePercentThreshold) {
            return;
        }

        const now = Date.now();
        if (this.lastAlertSentAt !== null && now - this.lastAlertSentAt < this.cooldownMs) {
            this.logger.debug(
                {
                    freePercent: freePercent.toFixed(1),
                    cooldownRemainingMs: this.cooldownMs - (now - this.lastAlertSentAt),
                },
                'Disk space alert suppressed by cooldown'
            );
            return;
        }

        this.lastAlertSentAt = now;

        this.logger.warn(
            {
                freePercent: freePercent.toFixed(1),
                freePercentThreshold: this.freePercentThreshold,
            },
            'Disk space below threshold, sending alert'
        );

        await this.notificationService.sendDiskSpaceAlert(
            diskFreeBytes,
            diskTotalBytes,
            freePercent
        );
    }
}
