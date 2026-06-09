/**
 * Heartbeats table schema
 */
export interface HeartbeatsTable {
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
    connected_devices_total: number | null;
    connected_devices_wifi: number | null;
    sfp_pwr_rx_dbm: number | null;
    sfp_pwr_tx_dbm: number | null;
    temp_cpu: number | null;
    temp_switch: number | null;
    fan_rpm: number | null;
    uptime: number | null;
    active_devices: string | null;
    metadata: string | null;
    disk_temp: number | null;
    disk_used_bytes: number | null;
    disk_free_bytes: number | null;
    disk_total_bytes: number | null;
    disk_read_errors: number | null;
    disk_write_errors: number | null;
}

/**
 * Insert type for heartbeats (omit auto-generated fields)
 */
export interface HeartbeatsInsert {
    status: string;
    timestamp: Date;
    ipv4?: string | null;
    ipv6?: string | null;
    media_state?: string | null;
    connection_type?: string | null;
    bandwidth_down?: number | null;
    bandwidth_up?: number | null;
    rate_down?: number | null;
    rate_up?: number | null;
    bytes_down?: number | null;
    bytes_up?: number | null;
    connected_devices_total?: number | null;
    connected_devices_wifi?: number | null;
    sfp_pwr_rx_dbm?: number | null;
    sfp_pwr_tx_dbm?: number | null;
    temp_cpu?: number | null;
    temp_switch?: number | null;
    fan_rpm?: number | null;
    uptime?: number | null;
    active_devices?: string | null;
    metadata?: string | null;
    received_at?: Date;
    disk_temp?: number | null;
    disk_used_bytes?: number | null;
    disk_free_bytes?: number | null;
    disk_total_bytes?: number | null;
    disk_read_errors?: number | null;
    disk_write_errors?: number | null;
}

/**
 * Devices table schema (registry of known LAN devices, deduplicated by MAC)
 */
export interface DevicesTable {
    id: number;
    mac: string;
    name: string;
    type: string;
    first_seen_at: Date;
    last_seen_at: Date;
}

/**
 * Insert type for devices
 */
export interface DevicesInsert {
    mac: string;
    name: string;
    type: string;
    first_seen_at: Date;
    last_seen_at: Date;
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
