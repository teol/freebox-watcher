import 'dotenv/config';
import Fastify from 'fastify';
import { testConnection, closeConnection } from './db/config.js';
import { heartbeatRoutes } from './routes/heartbeat.js';
import { healthRoutes } from './routes/health.js';

/**
 * Create Fastify instance with Pino logger
 */
const fastify = Fastify({
    logger: {
        level: process.env.LOG_LEVEL || 'info',
        transport:
            process.env.NODE_ENV !== 'production'
                ? {
                      target: 'pino-pretty',
                      options: {
                          colorize: true,
                          translateTime: 'HH:MM:ss Z',
                          ignore: 'pid,hostname',
                      },
                  }
                : undefined,
    },
});

/**
 * Register routes
 */
async function registerRoutes() {
    await fastify.register(healthRoutes);
    await fastify.register(heartbeatRoutes);
}

/**
 * Start the server
 */
async function start() {
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
        const port = parseInt(process.env.PORT, 10) || 3001;
        const host = process.env.HOST || '0.0.0.0';

        await fastify.listen({ port, host });

        fastify.log.info(`Server listening on ${host}:${port}`);
    } catch (error) {
        fastify.log.error(error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown
 */
async function shutdown(signal) {
    fastify.log.info(`Received ${signal}, shutting down gracefully...`);

    try {
        await fastify.close();
        await closeConnection();
        fastify.log.info('Server shut down successfully');
        process.exit(0);
    } catch (error) {
        fastify.log.error('Error during shutdown:', error);
        process.exit(1);
    }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
start();
