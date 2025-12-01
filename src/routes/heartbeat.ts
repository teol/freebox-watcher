import { type FastifyInstance, type FastifyPluginAsync, type RouteShorthandOptions } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import heartbeatService, { type HeartbeatInput } from '../services/heartbeat.js';
import downtimeService from '../services/downtime.js';

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
                required: ['connection_state', 'timestamp'],
                properties: {
                    connection_state: { type: 'string' },
                    timestamp: { type: 'string' },
                    token: { type: 'string' },
                    ipv4: { type: 'string' },
                    ipv6: { type: 'string' },
                    media_state: { type: 'string' },
                    connection_type: { type: 'string' },
                    bandwidth_down: { type: 'number' },
                    bandwidth_up: { type: 'number' },
                    rate_down: { type: 'number' },
                    rate_up: { type: 'number' },
                    bytes_down: { type: 'number' },
                    bytes_up: { type: 'number' },
                },
                additionalProperties: true,
            },
        },
    };

    fastify.post<{ Body: HeartbeatRequestBody }>('/heartbeat', schema, async (request, reply) => {
        try {
            const { timestamp, ...heartbeatData } = request.body;

            // Validate timestamp
            const timestampDate = new Date(timestamp);
            if (Number.isNaN(timestampDate.getTime())) {
                return reply.code(400).send({
                    error: 'Bad Request',
                    message: 'Invalid timestamp format',
                });
            }

            // Record the heartbeat (passes entire body to service)
            const id = await heartbeatService.recordHeartbeat({
                ...heartbeatData,
                timestamp,
            });

            // Check if we need to end any active downtime
            const activeDowntime = await downtimeService.getActiveDowntimeEvent();
            const connectionState = heartbeatData.connection_state;

            if (activeDowntime && connectionState === 'up') {
                const endedAt = new Date();
                await downtimeService.endDowntimeEvent(activeDowntime.id, endedAt);

                // Mark downtime as ended in the monitor
                fastify.downtimeMonitor.markDowntimeEnded(activeDowntime.id);

                fastify.log.info({ downtimeId: activeDowntime.id }, 'Downtime event ended');

                // Send recovery notification
                if (fastify.notificationService.isEnabled()) {
                    await fastify.notificationService.sendRecoveryAlert(
                        activeDowntime.id,
                        activeDowntime.started_at,
                        endedAt
                    );
                }
            }

            fastify.log.info(
                { heartbeatId: id, connection_state: connectionState },
                'Heartbeat recorded'
            );

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
