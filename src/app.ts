import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerRawBodyCapture } from './middleware/rawBodyCapture.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { NotificationService } from './services/notification.js';
import { DowntimeMonitor } from './services/downtimeMonitor.js';
import { HeartbeatService } from './services/heartbeat.js';
import { DailyChartService } from './services/dailyChart.js';
import { DevicesChartService } from './services/devicesChart.js';
import { getLoggerOptions } from './utils/logger.js';
import { API_PREFIX } from './constants/api.js';

/**
 * Creates and configures the Fastify application instance.
 * Registers plugins, middleware, services, and routes — but does NOT
 * connect to the database or start listening on a port.
 */
export async function createApp(): Promise<FastifyInstance> {
    const fastify: FastifyInstance = Fastify({
        logger: getLoggerOptions(),
        trustProxy: ['127.0.0.1', '::1'],
    });

    await fastify.register(rateLimit, {
        max: 5,
        timeWindow: '1 minute',
        errorResponseBuilder: () => ({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded',
        }),
    });

    await registerRawBodyCapture(fastify);

    const notificationService = new NotificationService(fastify.log);
    const downtimeMonitor = new DowntimeMonitor(fastify.log, notificationService);
    const heartbeatService = new HeartbeatService();
    const dailyChartService = new DailyChartService(
        heartbeatService,
        process.env.DISCORD_WEBHOOK_URL,
        process.env.CRON_SCHEDULE
    );
    const devicesChartService = new DevicesChartService(
        heartbeatService,
        process.env.DISCORD_WEBHOOK_URL,
        process.env.DEVICES_CRON_SCHEDULE,
        process.env.DEVICES_CHART_ENABLED === 'true'
    );

    fastify.decorate('notificationService', notificationService);
    fastify.decorate('downtimeMonitor', downtimeMonitor);
    fastify.decorate('dailyChartService', dailyChartService);
    fastify.decorate('devicesChartService', devicesChartService);

    await fastify.register(heartbeatRoutes, { prefix: API_PREFIX });

    return fastify;
}
