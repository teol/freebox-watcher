import {
    GraphQLBoolean,
    GraphQLError,
    GraphQLFloat,
    GraphQLID,
    GraphQLInt,
    GraphQLList,
    GraphQLNonNull,
    GraphQLObjectType,
    GraphQLScalarType,
    GraphQLSchema,
    GraphQLString,
    Kind,
} from 'graphql';
import { type HeartbeatRecord, type HeartbeatService } from '../services/heartbeat.js';
import { type DowntimeEvent, type DowntimeService } from '../services/downtime.js';

/**
 * Maximum number of items returned by a paginated field
 */
export const MAX_PAGE_SIZE = 1000;

/**
 * Default number of items returned by a paginated field
 */
const DEFAULT_PAGE_SIZE = 100;

/**
 * Services used by the GraphQL resolvers (injectable for testing)
 */
export interface GraphqlDataSources {
    heartbeatService: Pick<
        HeartbeatService,
        'getLastHeartbeat' | 'getHeartbeatById' | 'getHeartbeatsPage'
    >;
    downtimeService: Pick<DowntimeService, 'getActiveDowntimeEvent' | 'getDowntimeEventsPage'>;
}

/**
 * Heartbeat as exposed by the GraphQL API
 *
 * This is an explicit allowlist: sensitive columns (public IP addresses, active devices
 * with their MAC addresses and names, free-form metadata) are intentionally absent.
 */
interface HeartbeatDto {
    id: number;
    status: string;
    timestamp: Date;
    receivedAt: Date;
    mediaState: string | null;
    connectionType: string | null;
    bandwidthDown: number | null;
    bandwidthUp: number | null;
    rateDown: number | null;
    rateUp: number | null;
    bytesDown: number | null;
    bytesUp: number | null;
    connectedDevicesTotal: number | null;
    connectedDevicesWifi: number | null;
    sfpPwrRxDbm: number | null;
    sfpPwrTxDbm: number | null;
    tempCpu: number | null;
    tempSwitch: number | null;
    fanRpm: number | null;
    uptime: number | null;
    diskTemp: number | null;
    diskUsedBytes: number | null;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    diskReadErrors: number | null;
    diskWriteErrors: number | null;
}

/**
 * Downtime event as exposed by the GraphQL API (free-form notes are not exposed)
 */
interface DowntimeDto {
    id: number;
    startedAt: Date;
    endedAt: Date | null;
    duration: number | null;
    isActive: boolean;
}

interface PageArgs {
    from: Date;
    to: Date;
    limit: number;
    offset: number;
}

function toHeartbeatDto(heartbeat: HeartbeatRecord): HeartbeatDto {
    return {
        id: heartbeat.id,
        status: heartbeat.status,
        timestamp: heartbeat.timestamp,
        receivedAt: heartbeat.received_at,
        mediaState: heartbeat.media_state,
        connectionType: heartbeat.connection_type,
        bandwidthDown: heartbeat.bandwidth_down,
        bandwidthUp: heartbeat.bandwidth_up,
        rateDown: heartbeat.rate_down,
        rateUp: heartbeat.rate_up,
        bytesDown: heartbeat.bytes_down,
        bytesUp: heartbeat.bytes_up,
        connectedDevicesTotal: heartbeat.connected_devices_total,
        connectedDevicesWifi: heartbeat.connected_devices_wifi,
        sfpPwrRxDbm: heartbeat.sfp_pwr_rx_dbm,
        sfpPwrTxDbm: heartbeat.sfp_pwr_tx_dbm,
        tempCpu: heartbeat.temp_cpu,
        tempSwitch: heartbeat.temp_switch,
        fanRpm: heartbeat.fan_rpm,
        uptime: heartbeat.uptime,
        diskTemp: heartbeat.disk_temp,
        diskUsedBytes: heartbeat.disk_used_bytes,
        diskFreeBytes: heartbeat.disk_free_bytes,
        diskTotalBytes: heartbeat.disk_total_bytes,
        diskReadErrors: heartbeat.disk_read_errors,
        diskWriteErrors: heartbeat.disk_write_errors,
    };
}

function toDowntimeDto(event: DowntimeEvent): DowntimeDto {
    return {
        id: event.id,
        startedAt: event.started_at,
        endedAt: event.ended_at,
        duration: event.duration,
        // MariaDB returns BOOLEAN columns as TINYINT (0/1)
        isActive: Boolean(event.is_active),
    };
}

function parseDateTime(value: unknown): Date {
    if (typeof value !== 'string') {
        throw new GraphQLError('DateTime must be an ISO 8601 string');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new GraphQLError(`Invalid DateTime: "${value}"`);
    }

    return date;
}

const DateTimeScalar = new GraphQLScalarType<Date, string>({
    name: 'DateTime',
    description: 'ISO 8601 date-time string (e.g. 2026-01-31T12:00:00.000Z)',
    coerceOutputValue(value: unknown): string {
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) {
            throw new GraphQLError('DateTime cannot represent an invalid date');
        }
        return date.toISOString();
    },
    coerceInputValue: parseDateTime,
    coerceInputLiteral(valueNode): Date {
        if (valueNode.kind !== Kind.STRING) {
            throw new GraphQLError('DateTime must be an ISO 8601 string');
        }
        return parseDateTime(valueNode.value);
    },
});

/**
 * Validates pagination arguments and returns them unchanged
 * @throws GraphQLError if the arguments are out of bounds
 */
function validatePageArgs(args: PageArgs): PageArgs {
    if (args.from.getTime() > args.to.getTime()) {
        throw new GraphQLError('"from" must be earlier than or equal to "to"');
    }
    if (args.limit < 1 || args.limit > MAX_PAGE_SIZE) {
        throw new GraphQLError(`"limit" must be between 1 and ${MAX_PAGE_SIZE}`);
    }
    if (args.offset < 0) {
        throw new GraphQLError('"offset" must be greater than or equal to 0');
    }
    return args;
}

/**
 * Parses a GraphQL ID into a positive database ID
 * @throws GraphQLError if the ID is not a positive integer
 */
function parseId(id: string): number {
    if (!/^[1-9]\d{0,14}$/.test(id)) {
        throw new GraphQLError('"id" must be a positive integer');
    }
    return Number.parseInt(id, 10);
}

const pageArgs = {
    from: { type: new GraphQLNonNull(DateTimeScalar) },
    to: { type: new GraphQLNonNull(DateTimeScalar) },
    limit: { type: new GraphQLNonNull(GraphQLInt), defaultValue: DEFAULT_PAGE_SIZE },
    offset: { type: new GraphQLNonNull(GraphQLInt), defaultValue: 0 },
};

const HeartbeatType = new GraphQLObjectType<HeartbeatDto>({
    name: 'Heartbeat',
    fields: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        status: { type: new GraphQLNonNull(GraphQLString), description: 'Connection state' },
        timestamp: { type: new GraphQLNonNull(DateTimeScalar) },
        receivedAt: { type: new GraphQLNonNull(DateTimeScalar) },
        mediaState: { type: GraphQLString },
        connectionType: { type: GraphQLString },
        // 64-bit counters exceed GraphQL Int (32-bit): Float is exact up to 2^53
        bandwidthDown: { type: GraphQLFloat, description: 'Max download bandwidth (bit/s)' },
        bandwidthUp: { type: GraphQLFloat, description: 'Max upload bandwidth (bit/s)' },
        rateDown: { type: GraphQLFloat, description: 'Current download rate (bytes/s)' },
        rateUp: { type: GraphQLFloat, description: 'Current upload rate (bytes/s)' },
        bytesDown: { type: GraphQLFloat, description: 'Total downloaded bytes' },
        bytesUp: { type: GraphQLFloat, description: 'Total uploaded bytes' },
        connectedDevicesTotal: { type: GraphQLInt },
        connectedDevicesWifi: { type: GraphQLInt },
        sfpPwrRxDbm: { type: GraphQLFloat },
        sfpPwrTxDbm: { type: GraphQLFloat },
        tempCpu: { type: GraphQLInt, description: 'CPU temperature (°C)' },
        tempSwitch: { type: GraphQLInt, description: 'Switch temperature (°C)' },
        fanRpm: { type: GraphQLInt },
        uptime: { type: GraphQLFloat, description: 'Freebox uptime (seconds)' },
        diskTemp: { type: GraphQLInt, description: 'Disk temperature (°C)' },
        diskUsedBytes: { type: GraphQLFloat },
        diskFreeBytes: { type: GraphQLFloat },
        diskTotalBytes: { type: GraphQLFloat },
        diskReadErrors: { type: GraphQLInt },
        diskWriteErrors: { type: GraphQLInt },
    },
});

const DowntimeType = new GraphQLObjectType<DowntimeDto>({
    name: 'Downtime',
    fields: {
        id: { type: new GraphQLNonNull(GraphQLID) },
        startedAt: { type: new GraphQLNonNull(DateTimeScalar) },
        endedAt: { type: DateTimeScalar },
        duration: { type: GraphQLInt, description: 'Duration in seconds (null while active)' },
        isActive: { type: new GraphQLNonNull(GraphQLBoolean) },
    },
});

/**
 * Creates the read-only GraphQL schema
 * @param dataSources Services used by the resolvers
 * @returns The GraphQL schema
 */
export function createGraphqlSchema(dataSources: GraphqlDataSources): GraphQLSchema {
    const { heartbeatService, downtimeService } = dataSources;

    const queryType = new GraphQLObjectType({
        name: 'Query',
        fields: {
            lastHeartbeat: {
                type: HeartbeatType,
                resolve: async (): Promise<HeartbeatDto | null> => {
                    const heartbeat = await heartbeatService.getLastHeartbeat();
                    return heartbeat ? toHeartbeatDto(heartbeat) : null;
                },
            },
            heartbeat: {
                type: HeartbeatType,
                args: { id: { type: new GraphQLNonNull(GraphQLID) } },
                resolve: async (_source, args: { id: string }): Promise<HeartbeatDto | null> => {
                    const heartbeat = await heartbeatService.getHeartbeatById(parseId(args.id));
                    return heartbeat ? toHeartbeatDto(heartbeat) : null;
                },
            },
            heartbeats: {
                type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(HeartbeatType))),
                description: `Heartbeats in a time range, oldest first (max ${MAX_PAGE_SIZE} per page)`,
                args: pageArgs,
                resolve: async (_source, args: PageArgs): Promise<HeartbeatDto[]> => {
                    const { from, to, limit, offset } = validatePageArgs(args);
                    const heartbeats = await heartbeatService.getHeartbeatsPage(
                        from,
                        to,
                        limit,
                        offset
                    );
                    return heartbeats.map(toHeartbeatDto);
                },
            },
            activeDowntime: {
                type: DowntimeType,
                resolve: async (): Promise<DowntimeDto | null> => {
                    const event = await downtimeService.getActiveDowntimeEvent();
                    return event ? toDowntimeDto(event) : null;
                },
            },
            downtimes: {
                type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(DowntimeType))),
                description: `Downtimes overlapping a time range, newest first (max ${MAX_PAGE_SIZE} per page)`,
                args: pageArgs,
                resolve: async (_source, args: PageArgs): Promise<DowntimeDto[]> => {
                    const { from, to, limit, offset } = validatePageArgs(args);
                    const events = await downtimeService.getDowntimeEventsPage(
                        from,
                        to,
                        limit,
                        offset
                    );
                    return events.map(toDowntimeDto);
                },
            },
        },
    });

    return new GraphQLSchema({ query: queryType });
}
