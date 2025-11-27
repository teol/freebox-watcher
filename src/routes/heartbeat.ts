import { type FastifyInstance, type FastifyPluginAsync, type RouteShorthandOptions } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import heartbeatService, { type HeartbeatInput } from '../services/heartbeat.js';
import downtimeService from '../services/downtime.js';
import notificationService from '../services/notification.js';
import downtimeMonitor from '../services/downtimeMonitor.js';

type HeartbeatRequestBody = HeartbeatInput;

type HeartbeatRouteOptions = RouteShorthandOptions;

/**
 * Heartbeat routes
 */
export const heartbeatRoutes: FastifyPluginAsync = async (fastify): Promise<void> => {
    /**
     * POST /heartbeat
     * Record a new heartbeat
     */
    const schema: HeartbeatRouteOptions = {
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
    };

    fastify.post<{ Body: HeartbeatRequestBody }>('/heartbeat', schema, async (request, reply) => {
        try {
            const { status, timestamp, metadata } = request.body;

            // Validate timestamp
            const timestampDate = new Date(timestamp);
            if (Number.isNaN(timestampDate.getTime())) {
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
                const endedAt = new Date();
                await downtimeService.endDowntimeEvent(activeDowntime.id, endedAt);

                // Mark downtime as ended in the monitor
                downtimeMonitor.markDowntimeEnded(activeDowntime.id);

                fastify.log.info({ downtimeId: activeDowntime.id }, 'Downtime event ended');

                // Send recovery notification
                if (notificationService.isEnabled()) {
                    await notificationService.sendRecoveryAlert(
                        activeDowntime.id,
                        new Date(activeDowntime.started_at),
                        endedAt
                    );
                }
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
    });
};
