import { db } from '../db/config.js';

export interface DowntimeEvent {
    id: number;
    started_at: Date;
    ended_at?: Date | null;
    duration?: number | null;
    is_active: boolean;
    notes?: string | null;
}

/**
 * DowntimeService handles tracking and managing downtime events
 */
export class DowntimeService {
    /**
     * Create a new downtime event
     * @param startedAt When the downtime started
     * @param notes Optional notes about the downtime
     * @returns The ID of the created downtime event
     */
    async createDowntimeEvent(startedAt: Date, notes: string | null = null): Promise<number> {
        const [id] = await db('downtime_events').insert({
            started_at: startedAt,
            is_active: true,
            notes,
        });

        return id as number;
    }

    /**
     * End an active downtime event
     * @param id The downtime event ID
     * @param endedAt When the downtime ended
     */
    async endDowntimeEvent(id: number, endedAt: Date): Promise<void> {
        const downtimeEvent = await db<DowntimeEvent>('downtime_events').where('id', id).first();

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
     * @returns Active downtime event or null
     */
    async getActiveDowntimeEvent(): Promise<DowntimeEvent | null> {
        const event = await db<DowntimeEvent>('downtime_events')
            .where('is_active', true)
            .orderBy('started_at', 'desc')
            .first();

        return event ?? null;
    }

    /**
     * Get all downtime events
     * @param limit Maximum number of events to return
     * @returns Array of downtime events
     */
    async getAllDowntimeEvents(limit = 100): Promise<DowntimeEvent[]> {
        return await db<DowntimeEvent>('downtime_events')
            .orderBy('started_at', 'desc')
            .limit(limit);
    }

    /**
     * Get downtime events within a date range
     * @param startDate Start date
     * @param endDate End date
     * @returns Array of downtime events
     */
    async getDowntimeEventsInRange(startDate: Date, endDate: Date): Promise<DowntimeEvent[]> {
        return await db<DowntimeEvent>('downtime_events')
            .where((builder) => {
                builder
                    .whereBetween('started_at', [startDate, endDate])
                    .orWhereBetween('ended_at', [startDate, endDate]);
            })
            .orderBy('started_at', 'desc');
    }

    /**
     * Calculate total downtime in a period
     * @param startDate Start date
     * @param endDate End date
     * @returns Total downtime in seconds
     */
    async getTotalDowntime(startDate: Date, endDate: Date): Promise<number> {
        const events = await this.getDowntimeEventsInRange(startDate, endDate);
        return events.reduce((total, event) => total + (event.duration ?? 0), 0);
    }
}

export default new DowntimeService();
