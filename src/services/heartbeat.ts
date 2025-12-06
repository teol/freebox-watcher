import { db } from '../db/config.js';
import type { HeartbeatsTable, HeartbeatsInsert } from '../types/database.js';

export interface HeartbeatRecord {
    id: number;
    status: string;
    timestamp: Date;
    received_at: Date;
    ipv4: string | null;
    ipv6: string | null;
    media_state: string | null;
    connection_type: string | null;
    bandwidth_down: number | null;
    bandwidth_up: number | null;
    rate_down: number | null;
    rate_up: number | null;
    bytes_down: number | null;
    bytes_up: number | null;
    metadata: Record<string, unknown> | null;
}

export interface HeartbeatInput {
    connection_state: string;
    timestamp: string | Date;
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
        const {
            connection_state,
            timestamp,
            ipv4,
            ipv6,
            media_state,
            connection_type,
            bandwidth_down,
            bandwidth_up,
            rate_down,
            rate_up,
            bytes_down,
            bytes_up,
            ...additionalFields
        } = heartbeatData;

        // Collect all additional fields into metadata, filtering out undefined values
        const metadata = Object.fromEntries(
            Object.entries(additionalFields).filter(([, value]) => value !== undefined)
        );

        const insertData: HeartbeatsInsert = {
            status: connection_state,
            timestamp: new Date(timestamp),
            ipv4: ipv4 ?? null,
            ipv6: ipv6 ?? null,
            media_state: media_state ?? null,
            connection_type: connection_type ?? null,
            bandwidth_down: bandwidth_down ?? null,
            bandwidth_up: bandwidth_up ?? null,
            rate_down: rate_down ?? null,
            rate_up: rate_up ?? null,
            bytes_down: bytes_down ?? null,
            bytes_up: bytes_up ?? null,
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

    /**
     * Get all stored heartbeats ordered by timestamp
     * @returns Array of heartbeats
     */
    async getAllHeartbeats(): Promise<HeartbeatRecord[]> {
        const heartbeats = await db<HeartbeatsTable>('heartbeats').orderBy('timestamp', 'asc');

        return heartbeats.map((heartbeat) => ({
            ...heartbeat,
            metadata: heartbeat.metadata ? JSON.parse(heartbeat.metadata) : null,
        }));
    }
}

export default new HeartbeatService();
