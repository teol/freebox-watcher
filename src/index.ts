import 'dotenv/config';
import Fastify, { type FastifyInstance } from 'fastify';
import { testConnection, closeConnection } from './db/config.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { NotificationService } from './services/notification.js';
import { DowntimeMonitor } from './services/downtimeMonitor.js';
import { logger } from './utils/logger.js';

/**
 * Create Fastify instance with shared logger
 */
const fastify: FastifyInstance = Fastify({
    logger: logger,
});

/**
 * Initialize services with logger dependency injection
 */
const notificationService = new NotificationService(fastify.log);
const downtimeMonitor = new DowntimeMonitor(fastify.log, notificationService);

/**
 * Decorate fastify instance with services
 */
fastify.decorate('notificationService', notificationService);
fastify.decorate('downtimeMonitor', downtimeMonitor);

/**
 * Register routes
 */
async function registerRoutes(): Promise<void> {
    await fastify.register(heartbeatRoutes);
}

/**
 * Start the server
 */
async function start(): Promise<void> {
    try {
        // Validate required environment variables
        if (!process.env.API_KEY) {
            throw new Error('API_KEY environment variable is required');
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
