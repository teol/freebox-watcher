import 'fastify';
import { NotificationService } from '../services/notification.js';
import { DowntimeMonitor } from '../services/downtimeMonitor.js';
import { DailyChartService } from '../services/dailyChart.js';
import { DevicesChartService } from '../services/devicesChart.js';
import { DiskAlertService } from '../services/diskAlert.js';

declare module 'fastify' {
    interface FastifyInstance {
        notificationService: NotificationService;
        downtimeMonitor: DowntimeMonitor;
        dailyChartService: DailyChartService;
        devicesChartService: DevicesChartService;
        diskAlertService: DiskAlertService;
    }

    interface FastifyRequest {
        rawBody?: string;
    }
}
