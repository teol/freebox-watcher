import { db } from '../db/config.js';
import type { HeartbeatsTable, HeartbeatsInsert } from '../types/database.js';

export interface HeartbeatRecord {
    id: number;
    status: string;
    timestamp: Date;
    received_at: Date;
    metadata: Record<string, unknown> | null;
}

export interface HeartbeatInput {
    connection_state: string;
    timestamp: string | Date;
    token?: string;
    ipv4?: string;
    ipv6?: string;
    media_state?: string;
    connection_type?: string;
    bandwidth_down?: number;
    bandwidth_up?: number;
    rate_down?: number;
    rate_up?: number;
    bytes_down?: number;
    bytes_up?: number;
    [key: string]: unknown;
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
    async recordHeartbeat(heartbeatData: HeartbeatInput): Promise<number> {
        const { connection_state, timestamp, token, ...additionalFields } = heartbeatData;

        // Collect all additional fields into metadata (excluding token which is for auth only)
        const metadata: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(additionalFields)) {
            if (key !== 'token' && value !== undefined) {
                metadata[key] = value;
            }
        }

        const insertData: HeartbeatsInsert = {
            status: connection_state,
            timestamp: new Date(timestamp),
            metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
        };

        const [id] = await db<HeartbeatsTable>('heartbeats').insert(insertData);

        return id as number;
    }

    /**
     * Get the last heartbeat
     * @returns The last heartbeat or null if none exists
     */
    async getLastHeartbeat(): Promise<HeartbeatRecord | null> {
        const heartbeat = await db<HeartbeatsTable>('heartbeats')
            .orderBy('timestamp', 'desc')
            .first();

        if (!heartbeat) {
            return null;
        }

        return {
            ...heartbeat,
            metadata: heartbeat.metadata ? JSON.parse(heartbeat.metadata) : null,
        };
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
        const heartbeats = await db<HeartbeatsTable>('heartbeats')
            .whereBetween('timestamp', [startDate, endDate])
            .orderBy('timestamp', 'asc');

        return heartbeats.map((heartbeat) => ({
            ...heartbeat,
            metadata: heartbeat.metadata ? JSON.parse(heartbeat.metadata) : null,
        }));
    }

    /**
     * Delete old heartbeats (cleanup)
     * @param daysToKeep Number of days to keep
     * @returns Number of deleted records
     */
    async cleanupOldHeartbeats(daysToKeep = 30): Promise<number> {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        return await db<HeartbeatsTable>('heartbeats').where('timestamp', '<', cutoffDate).delete();
    }
}

export default new HeartbeatService();
