import { authMiddleware } from '../middleware/auth.js';
import heartbeatService from '../services/heartbeat.js';
import downtimeService from '../services/downtime.js';

/**
 * Heartbeat routes
 */
export async function heartbeatRoutes(fastify, options) {
    /**
     * POST /heartbeat
     * Record a new heartbeat
     */
    fastify.post(
        '/heartbeat',
        {
            preHandler: authMiddleware,
            schema: {
                body: {
                    type: 'object',
                    required: ['status', 'timestamp'],
                    properties: {
                        status: { type: 'string' },
                        timestamp: { type: 'string' },
                        metadata: { type: 'object' },
                    },
                },
            },
        },
        async (request, reply) => {
            try {
                const { status, timestamp, metadata } = request.body;

                // Validate timestamp
                const timestampDate = new Date(timestamp);
                if (isNaN(timestampDate.getTime())) {
                    return reply.code(400).send({
                        error: 'Bad Request',
                        message: 'Invalid timestamp format',
                    });
                }

                // Record the heartbeat
                const id = await heartbeatService.recordHeartbeat({
                    status,
                    timestamp,
                    metadata,
                });

                // Check if we need to end any active downtime
                const activeDowntime = await downtimeService.getActiveDowntimeEvent();
                if (activeDowntime && status === 'online') {
                    await downtimeService.endDowntimeEvent(activeDowntime.id, new Date());
                    fastify.log.info({ downtimeId: activeDowntime.id }, 'Downtime event ended');
                }

                fastify.log.info({ heartbeatId: id, status }, 'Heartbeat recorded');

                return reply.code(200).send({
                    success: true,
                    message: 'Heartbeat recorded',
                    id,
                });
            } catch (error) {
                fastify.log.error({ error }, 'Failed to record heartbeat');
                return reply.code(500).send({
                    error: 'Internal Server Error',
                    message: 'Failed to record heartbeat',
                });
            }
        }
    );
}
