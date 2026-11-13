import 'fastify';
import { NotificationService } from '../services/notification.js';
import { DowntimeMonitor } from '../services/downtimeMonitor.js';
import { ConnectionQualityMonitor } from '../services/connectionQualityMonitor.js';
import { DailyChartService } from '../services/dailyChart.js';
import { DevicesChartService } from '../services/devicesChart.js';

declare module 'fastify' {
    interface FastifyInstance {
        notificationService: NotificationService;
        downtimeMonitor: DowntimeMonitor;
        connectionQualityMonitor: ConnectionQualityMonitor;
        dailyChartService: DailyChartService;
        devicesChartService: DevicesChartService;
    }

    interface FastifyRequest {
        rawBody?: string;
    }
}
