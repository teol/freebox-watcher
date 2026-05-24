import { db } from '../db/config.js';
import type {
    HeartbeatsTable,
    HeartbeatsInsert,
    DevicesTable,
    DevicesInsert,
} from '../types/database.js';

export interface ActiveDevice {
    mac: string;
    name: string;
    type: string;
}

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
    connected_devices_total: number | null;
    connected_devices_wifi: number | null;
    sfp_pwr_rx_dbm: number | null;
    sfp_pwr_tx_dbm: number | null;
    temp_cpu: number | null;
    temp_switch: number | null;
    fan_rpm: number | null;
    uptime: number | null;
    active_devices: ActiveDevice[] | null;
    metadata: Record<string, unknown> | null;
}

export interface HeartbeatInput {
    connection_state: string;
    timestamp: string | Date;
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
    active_devices?: ActiveDevice[] | null;
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
            connected_devices_total,
            connected_devices_wifi,
            sfp_pwr_rx_dbm,
            sfp_pwr_tx_dbm,
            temp_cpu,
            temp_switch,
            fan_rpm,
            uptime,
            active_devices,
            ...additionalFields
        } = heartbeatData;

        // Collect all additional fields into metadata, filtering out undefined values
        const metadata = Object.fromEntries(
            Object.entries(additionalFields).filter(([, value]) => value !== undefined)
        );

        const activeDevicesList = active_devices ?? null;

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
            connected_devices_total: connected_devices_total ?? null,
            connected_devices_wifi: connected_devices_wifi ?? null,
            sfp_pwr_rx_dbm: sfp_pwr_rx_dbm ?? null,
            sfp_pwr_tx_dbm: sfp_pwr_tx_dbm ?? null,
            temp_cpu: temp_cpu ?? null,
            temp_switch: temp_switch ?? null,
            fan_rpm: fan_rpm ?? null,
            uptime: uptime ?? null,
            active_devices: activeDevicesList ? JSON.stringify(activeDevicesList) : null,
            metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
        };

        const [id] = await db<HeartbeatsTable>('heartbeats').insert(insertData);

        // Upsert devices with a non-empty MAC into the devices registry
        const devicesWithMac = (activeDevicesList ?? []).filter((d) => d.mac !== '');
        if (devicesWithMac.length > 0) {
            const now = new Date();
            await db<DevicesTable>('devices')
                .insert(
                    devicesWithMac.map(
                        (device): DevicesInsert => ({
                            mac: device.mac,
                            name: device.name,
                            type: device.type,
                            first_seen_at: now,
                            last_seen_at: now,
                        })
                    )
                )
                .onConflict('mac')
                .merge(['name', 'type', 'last_seen_at']);
        }

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
            active_devices: heartbeat.active_devices
                ? (JSON.parse(heartbeat.active_devices) as ActiveDevice[])
                : null,
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
            active_devices: heartbeat.active_devices
                ? (JSON.parse(heartbeat.active_devices) as ActiveDevice[])
                : null,
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
