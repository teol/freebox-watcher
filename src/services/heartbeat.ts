import { db } from '../db/config.js';

export interface HeartbeatRecord {
    id: number;
    status: string;
    timestamp: Date;
    received_at?: Date;
    metadata?: Record<string, unknown> | null;
}

export interface HeartbeatInsert {
    status: string;
    timestamp: string | Date;
    metadata?: Record<string, unknown> | null;
}

/**
 * HeartbeatService handles storing and managing heartbeat data
 */
export class HeartbeatService {
    /**
     * Record a new heartbeat
     * @param heartbeatData The heartbeat data
     * @returns The ID of the inserted heartbeat
     */
    async recordHeartbeat(heartbeatData: HeartbeatInsert): Promise<number> {
        const { status, timestamp, metadata = null } = heartbeatData;

        const [id] = await db('heartbeats').insert({
            status,
            timestamp: new Date(timestamp),
            metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return id as number;
    }

    /**
     * Get the last heartbeat
     * @returns The last heartbeat or null if none exists
     */
    async getLastHeartbeat(): Promise<HeartbeatRecord | null> {
        const heartbeat = await db<HeartbeatRecord>('heartbeats')
            .orderBy('timestamp', 'desc')
            .first();

        return heartbeat ?? null;
    }

    /**
     * Check if a downtime event should be created based on the last heartbeat
     * @returns True if downtime should be triggered
     */
    async shouldTriggerDowntime(): Promise<boolean> {
        const lastHeartbeat = await this.getLastHeartbeat();

        if (!lastHeartbeat) {
            return false;
        }

        const timeoutMs = Number.parseInt(process.env.HEARTBEAT_TIMEOUT ?? '300000', 10);
        const lastHeartbeatTime = new Date(lastHeartbeat.timestamp);
        const timeSinceLastHeartbeat = Date.now() - lastHeartbeatTime.getTime();

        return timeSinceLastHeartbeat > timeoutMs;
    }

    /**
     * Get heartbeats within a time range
     * @param startDate Start date
     * @param endDate End date
     * @returns Array of heartbeats
     */
    async getHeartbeatsInRange(startDate: Date, endDate: Date): Promise<HeartbeatRecord[]> {
        return await db<HeartbeatRecord>('heartbeats')
            .whereBetween('timestamp', [startDate, endDate])
            .orderBy('timestamp', 'asc');
    }

    /**
     * Delete old heartbeats (cleanup)
     * @param daysToKeep Number of days to keep
     * @returns Number of deleted records
     */
    async cleanupOldHeartbeats(daysToKeep = 30): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        return await db('heartbeats').where('timestamp', '<', cutoffDate).delete();
    }
}

export default new HeartbeatService();
