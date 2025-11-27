import 'fastify';
import { NotificationService } from '../services/notification.js';
import { DowntimeMonitor } from '../services/downtimeMonitor.js';

declare module 'fastify' {
    interface FastifyInstance {
        notificationService: NotificationService;
        downtimeMonitor: DowntimeMonitor;
    }
}
