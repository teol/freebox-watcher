import { testConnection } from '../db/config.js';

/**
 * Health check routes
 */
export async function healthRoutes(fastify, options) {
    /**
     * GET /health
     * Health check endpoint
     */
    fastify.get('/health', async (request, reply) => {
        try {
            // Test database connection
            await testConnection();

            return reply.code(200).send({
                status: 'ok',
                uptime: process.uptime(),
                database: 'connected',
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            fastify.log.error({ error }, 'Health check failed');
            return reply.code(503).send({
                status: 'error',
                uptime: process.uptime(),
                database: 'disconnected',
                timestamp: new Date().toISOString(),
                error: error.message,
            });
        }
    });
}
