import 'fastify';
import { NotificationService } from '../services/notification.js';
import { DowntimeMonitor } from '../services/downtimeMonitor.js';
import { DailyChartService } from '../services/dailyChart.js';

declare module 'fastify' {
    interface FastifyInstance {
        notificationService: NotificationService;
        downtimeMonitor: DowntimeMonitor;
        dailyChartService: DailyChartService;
    }

    interface FastifyRequest {
        rawBody?: string;
    }
}
