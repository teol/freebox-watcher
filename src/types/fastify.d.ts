import 'fastify';
import { NotificationService } from '../services/notification.js';
import { DowntimeMonitor } from '../services/downtimeMonitor.js';
import { HeartbeatReportService } from '../services/heartbeatReport.js';

declare module 'fastify' {
    interface FastifyInstance {
        notificationService: NotificationService;
        downtimeMonitor: DowntimeMonitor;
        heartbeatReportService: HeartbeatReportService;
    }

    interface FastifyRequest {
        rawBody?: string;
    }
}
