import { db } from '../db/config.js';

/**
 * HeartbeatService handles storing and managing heartbeat data
 */
export class HeartbeatService {
    /**
     * Record a new heartbeat
     * @param {Object} heartbeatData - The heartbeat data
     * @param {string} heartbeatData.status - Status of the heartbeat (e.g., 'online')
     * @param {string} heartbeatData.timestamp - ISO timestamp of the heartbeat
     * @param {Object} [heartbeatData.metadata] - Optional metadata
     * @returns {Promise<number>} The ID of the inserted heartbeat
     */
    async recordHeartbeat(heartbeatData) {
        const { status, timestamp, metadata = null } = heartbeatData;

        const [id] = await db('heartbeats').insert({
            status,
            timestamp: new Date(timestamp),
            metadata: metadata ? JSON.stringify(metadata) : null,
        });

        return id;
    }

    /**
     * Get the last heartbeat
     * @returns {Promise<Object|null>} The last heartbeat or null if none exists
     */
    async getLastHeartbeat() {
        const heartbeat = await db('heartbeats').orderBy('timestamp', 'desc').first();

        return heartbeat || null;
    }

    /**
     * Check if a downtime event should be created based on the last heartbeat
     * @returns {Promise<boolean>} True if downtime should be triggered
     */
    async shouldTriggerDowntime() {
        const lastHeartbeat = await this.getLastHeartbeat();

        if (!lastHeartbeat) {
            return false;
        }

        const timeoutMs = parseInt(process.env.HEARTBEAT_TIMEOUT, 10) || 300000;
        const lastHeartbeatTime = new Date(lastHeartbeat.timestamp);
        const timeSinceLastHeartbeat = Date.now() - lastHeartbeatTime.getTime();

        return timeSinceLastHeartbeat > timeoutMs;
    }

    /**
     * Get heartbeats within a time range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Array>} Array of heartbeats
     */
    async getHeartbeatsInRange(startDate, endDate) {
        return await db('heartbeats')
            .whereBetween('timestamp', [startDate, endDate])
            .orderBy('timestamp', 'asc');
    }

    /**
     * Delete old heartbeats (cleanup)
     * @param {number} daysToKeep - Number of days to keep
     * @returns {Promise<number>} Number of deleted records
     */
    async cleanupOldHeartbeats(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

        return await db('heartbeats').where('timestamp', '<', cutoffDate).delete();
    }
}

export default new HeartbeatService();
