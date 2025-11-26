import { db } from '../db/config.js';

/**
 * DowntimeService handles tracking and managing downtime events
 */
export class DowntimeService {
    /**
     * Create a new downtime event
     * @param {Date} startedAt - When the downtime started
     * @param {string} [notes] - Optional notes about the downtime
     * @returns {Promise<number>} The ID of the created downtime event
     */
    async createDowntimeEvent(startedAt, notes = null) {
        const [id] = await db('downtime_events').insert({
            started_at: startedAt,
            is_active: true,
            notes,
        });

        return id;
    }

    /**
     * End an active downtime event
     * @param {number} id - The downtime event ID
     * @param {Date} endedAt - When the downtime ended
     * @returns {Promise<void>}
     */
    async endDowntimeEvent(id, endedAt) {
        const downtimeEvent = await db('downtime_events').where('id', id).first();

        if (!downtimeEvent) {
            throw new Error(`Downtime event with ID ${id} not found`);
        }

        const startedAt = new Date(downtimeEvent.started_at);
        const duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);

        await db('downtime_events').where('id', id).update({
            ended_at: endedAt,
            duration,
            is_active: false,
        });
    }

    /**
     * Get the current active downtime event if any
     * @returns {Promise<Object|null>} Active downtime event or null
     */
    async getActiveDowntimeEvent() {
        return await db('downtime_events')
            .where('is_active', true)
            .orderBy('started_at', 'desc')
            .first();
    }

    /**
     * Get all downtime events
     * @param {number} [limit=100] - Maximum number of events to return
     * @returns {Promise<Array>} Array of downtime events
     */
    async getAllDowntimeEvents(limit = 100) {
        return await db('downtime_events').orderBy('started_at', 'desc').limit(limit);
    }

    /**
     * Get downtime events within a date range
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<Array>} Array of downtime events
     */
    async getDowntimeEventsInRange(startDate, endDate) {
        return await db('downtime_events')
            .where((builder) => {
                builder
                    .whereBetween('started_at', [startDate, endDate])
                    .orWhereBetween('ended_at', [startDate, endDate]);
            })
            .orderBy('started_at', 'desc');
    }

    /**
     * Calculate total downtime in a period
     * @param {Date} startDate - Start date
     * @param {Date} endDate - End date
     * @returns {Promise<number>} Total downtime in seconds
     */
    async getTotalDowntime(startDate, endDate) {
        const events = await this.getDowntimeEventsInRange(startDate, endDate);
        return events.reduce((total, event) => total + (event.duration || 0), 0);
    }
}

export default new DowntimeService();
