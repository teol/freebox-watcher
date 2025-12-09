import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import { testConnection, closeConnection } from './db/config.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { NotificationService } from './services/notification.js';
import { DowntimeMonitor } from './services/downtimeMonitor.js';
import { HeartbeatService } from './services/heartbeat.js';
import { DailyChartService } from './services/dailyChart.js';
import { getLoggerOptions } from './utils/logger.js';
import { API_PREFIX } from './constants/api.js';

/**
 * Create Fastify instance with logger configuration
 */
const fastify: FastifyInstance = Fastify({
    logger: getLoggerOptions(),
    trustProxy: ['127.0.0.1', '::1'],
});

/**
 * Register raw body capture for HMAC signature verification
 */
await import('./middleware/rawBodyCapture.js').then(({ registerRawBodyCapture }) =>
    registerRawBodyCapture(fastify)
);

/**
 * Set custom 404 handler that silently drops connections
 * This makes the server invisible to port scanners and attackers
 */
fastify.setNotFoundHandler((request, reply) => {
    // Log invalid route attempts only in non-production environments
    if (process.env.NODE_ENV !== 'production') {
        fastify.log.warn({ url: request.url, method: request.method }, 'Invalid route accessed');
    }

    // Destroy the underlying socket without sending any HTTP response
    // This makes it appear as if nothing is listening on this port
    reply.hijack();
    request.raw.socket?.destroy();
});

/**
 * Set custom error handler to prevent information disclosure
 * Errors are logged internally but the connection is dropped silently
 */
fastify.setErrorHandler((error, request, reply) => {
    // Log the error internally for debugging (only in non-production)
    if (process.env.NODE_ENV !== 'production') {
        fastify.log.error({ error, url: request.url, method: request.method }, 'Request error');
    }

    // Silently close the connection without revealing server information
    reply.hijack();
    request.raw.socket?.destroy();
});

/**
 * Initialize services with logger dependency injection
 */
const notificationService = new NotificationService(fastify.log);
const downtimeMonitor = new DowntimeMonitor(fastify.log, notificationService);
const heartbeatService = new HeartbeatService();
const dailyChartService = new DailyChartService(heartbeatService, process.env.DISCORD_WEBHOOK_URL);

/**
 * Decorate fastify instance with services
 */
fastify.decorate('notificationService', notificationService);
fastify.decorate('downtimeMonitor', downtimeMonitor);
fastify.decorate('dailyChartService', dailyChartService);

/**
 * Register routes
 */
async function registerRoutes(): Promise<void> {
    await fastify.register(heartbeatRoutes, { prefix: API_PREFIX });
}

/**
 * Start the server
 */
async function start(): Promise<void> {
    try {
        // Validate required environment variables
        if (!process.env.API_SECRET) {
            throw new Error('API_SECRET environment variable is required');
        }

        // Test database connection
        fastify.log.info('Testing database connection...');
        await testConnection();
        fastify.log.info('Database connection successful');

        // Register routes
        await registerRoutes();

        // Start server
        const port = Number.parseInt(process.env.PORT ?? '3001', 10);
        const host = process.env.HOST || '127.0.0.1';

        await fastify.listen({ port, host });

        fastify.log.info(`Server listening on ${host}:${port}`);

        // Start downtime monitoring
        fastify.downtimeMonitor.start();

        // Start daily chart service
        fastify.dailyChartService.start();

        // Send startup notification
        await fastify.notificationService.sendStartupNotification();
    } catch (error) {
        fastify.log.error(error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal: string): Promise<void> {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);

    try {
        // Stop downtime monitoring
        fastify.downtimeMonitor.stop();

        // Stop daily chart service
        fastify.dailyChartService.stop();

        await fastify.close();
        await closeConnection();
        fastify.log.info('Server shut down successfully');
        process.exit(0);
    } catch (error) {
        fastify.log.error({ error }, 'Error during shutdown');
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
void start();
