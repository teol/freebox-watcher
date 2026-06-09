import 'dotenv/config';
import { createApp } from './app.js';
import { testConnection, closeConnection } from './db/config.js';

const fastify = await createApp();

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

        // Start server
        const port = Number.parseInt(process.env.PORT ?? '3001', 10);
        const host = process.env.HOST || '127.0.0.1';

        await fastify.listen({ port, host });

        fastify.log.info(`Server listening on ${host}:${port}`);

        // Start downtime monitoring
        fastify.downtimeMonitor.start();

        // Start daily chart service
        fastify.dailyChartService.start();

        // Start devices chart service
        fastify.devicesChartService.start();

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
        // fastify.close() triggers the onClose hook defined in app.ts,
        // which stops the downtime monitor and chart services.
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
