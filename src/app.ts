import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { registerRawBodyCapture } from './middleware/rawBodyCapture.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { graphqlRoutes } from './routes/graphql.js';
import { NotificationService } from './services/notification.js';
import { DowntimeMonitor } from './services/downtimeMonitor.js';
import { HeartbeatService } from './services/heartbeat.js';
import { DowntimeService } from './services/downtime.js';
import { DailyChartService } from './services/dailyChart.js';
import { DevicesChartService } from './services/devicesChart.js';
import { getLoggerOptions } from './utils/logger.js';
import { API_PREFIX } from './constants/api.js';
import { createGraphqlSchema } from './graphql/schema.js';
import { isGraphqlEnabled, loadGraphqlConfig } from './graphql/config.js';

interface AppOptions {
    /** Maximum number of requests per minute. Defaults to 5. Override in tests to avoid 429s. */
    rateLimitMax?: number;
}

/**
 * Creates and configures the Fastify application instance.
 * Registers plugins, middleware, services, and routes — but does NOT
 * connect to the database or start listening on a port.
 */
export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
    const { rateLimitMax = 5 } = options;

    const fastify: FastifyInstance = Fastify({
        logger: getLoggerOptions(),
        trustProxy: ['127.0.0.1', '::1'],
    });

    await fastify.register(rateLimit, {
        max: rateLimitMax,
        timeWindow: '1 minute',
        // statusCode is required, otherwise Fastify answers with a 500 instead of a 429
        errorResponseBuilder: (_request, context) => ({
            statusCode: context.statusCode,
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

    fastify.addHook('onClose', () => {
        downtimeMonitor.stop();
        dailyChartService.stop();
        devicesChartService.stop();
    });

    await fastify.register(heartbeatRoutes, { prefix: API_PREFIX });

    // Read-only GraphQL API, disabled by default (opt-in via GRAPHQL_ENABLED=true)
    if (isGraphqlEnabled()) {
        const { tokenHash, rateLimitMax } = loadGraphqlConfig();
        await fastify.register(graphqlRoutes, {
            prefix: API_PREFIX,
            schema: createGraphqlSchema({
                heartbeatService,
                downtimeService: new DowntimeService(),
            }),
            tokenHash,
            rateLimitMax,
        });
        fastify.log.info('GraphQL API enabled');
    }

    return fastify;
}
