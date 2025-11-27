/**
 * Heartbeats table schema
 */
export interface HeartbeatsTable {
    id: number;
    status: string;
    timestamp: Date;
    received_at: Date;
    metadata: string | null;
}

/**
 * Insert type for heartbeats (omit auto-generated fields)
 */
export interface HeartbeatsInsert {
    status: string;
    timestamp: Date;
    metadata?: string | null;
    received_at?: Date;
}

/**
 * Update type for heartbeats
 */
export type HeartbeatsUpdate = Partial<Omit<HeartbeatsTable, 'id'>>;

/**
 * Downtime events table schema
 */
export interface DowntimeEventsTable {
    id: number;
    started_at: Date;
    ended_at: Date | null;
    duration: number | null;
    is_active: boolean;
    notes: string | null;
}

/**
 * Insert type for downtime events (omit auto-generated fields)
 */
export interface DowntimeEventsInsert {
    started_at: Date;
    ended_at?: Date | null;
    duration?: number | null;
    is_active?: boolean;
    notes?: string | null;
}

/**
 * Update type for downtime events
 */
export type DowntimeEventsUpdate = Partial<Omit<DowntimeEventsTable, 'id'>>;
