import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { graphqlRoutes } from '../src/routes/graphql.js';
import { createGraphqlSchema, MAX_PAGE_SIZE } from '../src/graphql/schema.js';
import { loadGraphqlConfig } from '../src/graphql/config.js';
import { createApp } from '../src/app.js';
import { API_PREFIX } from '../src/constants/api.js';
import { hashToken } from '../src/middleware/bearerAuth.js';
import { type HeartbeatRecord } from '../src/services/heartbeat.js';
import { type DowntimeEvent } from '../src/services/downtime.js';

interface GraphqlResponseBody {
    data?: Record<string, unknown> | null;
    errors?: { message: string }[];
}

const TEST_TOKEN = 'fbw_test-token-with-enough-entropy-for-tests-0123456789';
const TEST_TOKEN_HASH = hashToken(TEST_TOKEN).toString('hex');

const heartbeatFixture: HeartbeatRecord = {
    id: 42,
    status: 'up',
    timestamp: new Date('2026-01-01T12:00:00.000Z'),
    received_at: new Date('2026-01-01T12:00:01.000Z'),
    ipv4: '203.0.113.42',
    ipv6: '2001:db8::42',
    media_state: 'up',
    connection_type: 'ethernet',
    bandwidth_down: 8000000000,
    bandwidth_up: 700000000,
    rate_down: 1000,
    rate_up: 500,
    bytes_down: 9007199254740,
    bytes_up: 123456789012,
    connected_devices_total: 12,
    connected_devices_wifi: 8,
    sfp_pwr_rx_dbm: -12.5,
    sfp_pwr_tx_dbm: 2.1,
    temp_cpu: 55,
    temp_switch: 48,
    fan_rpm: 1200,
    uptime: 86400,
    active_devices: [{ mac: 'AA:BB:CC:DD:EE:FF', name: 'secret-laptop', type: 'laptop' }],
    metadata: { secret: 'metadata-value' },
    disk_temp: 40,
    disk_used_bytes: 1000,
    disk_free_bytes: 2000,
    disk_total_bytes: 3000,
    disk_read_errors: 0,
    disk_write_errors: 0,
};

const downtimeFixture: DowntimeEvent = {
    id: 7,
    started_at: new Date('2026-01-01T10:00:00.000Z'),
    ended_at: null,
    duration: null,
    is_active: true,
    notes: 'internal note',
};

interface PageCall {
    from: Date;
    to: Date;
    limit: number;
    offset: number;
}

describe('GraphQL Routes', () => {
    let fastify: FastifyInstance;
    const heartbeatPageCalls: PageCall[] = [];
    let failNextQuery = false;

    before(async () => {
        const schema = createGraphqlSchema({
            heartbeatService: {
                getLastHeartbeat: async () => {
                    if (failNextQuery) {
                        failNextQuery = false;
                        throw new Error('ER_ACCESS_DENIED_ERROR: secret SQL details');
                    }
                    return heartbeatFixture;
                },
                getHeartbeatById: async (id: number) => (id === 42 ? heartbeatFixture : null),
                getHeartbeatsPage: async (from, to, limit, offset) => {
                    heartbeatPageCalls.push({ from, to, limit, offset });
                    return [heartbeatFixture];
                },
            },
            downtimeService: {
                getActiveDowntimeEvent: async () => downtimeFixture,
                getDowntimeEventsPage: async () => [downtimeFixture],
            },
        });

        fastify = Fastify({ logger: false });
        await fastify.register(graphqlRoutes, {
            schema,
            tokenHash: hashToken(TEST_TOKEN),
            rateLimitMax: 1000,
        });
        await fastify.ready();
    });

    after(async () => {
        await fastify.close();
    });

    async function query(
        body: Record<string, unknown>,
        token: string | null = TEST_TOKEN
    ): Promise<{
        statusCode: number;
        body: GraphqlResponseBody;
        headers: Record<string, unknown>;
    }> {
        const response = await fastify.inject({
            method: 'POST',
            url: '/graphql',
            headers: {
                'content-type': 'application/json',
                ...(token !== null ? { authorization: `Bearer ${token}` } : {}),
            },
            payload: JSON.stringify(body),
        });
        return {
            statusCode: response.statusCode,
            body: response.json<GraphqlResponseBody>(),
            headers: response.headers,
        };
    }

    describe('Authentication', () => {
        it('should reject requests without Authorization header', async () => {
            const response = await query({ query: '{ lastHeartbeat { id } }' }, null);
            assert.strictEqual(response.statusCode, 401);
            assert.strictEqual(response.headers['www-authenticate'], 'Bearer');
            assert.strictEqual(response.body.data, undefined);
        });

        it('should reject requests with an invalid token', async () => {
            const response = await query({ query: '{ lastHeartbeat { id } }' }, 'wrong-token');
            assert.strictEqual(response.statusCode, 401);
        });

        it('should reject requests using another authentication scheme', async () => {
            const response = await fastify.inject({
                method: 'POST',
                url: '/graphql',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Basic ${TEST_TOKEN}`,
                },
                payload: JSON.stringify({ query: '{ lastHeartbeat { id } }' }),
            });
            assert.strictEqual(response.statusCode, 401);
        });

        it('should not accept the token from the query string', async () => {
            const response = await fastify.inject({
                method: 'POST',
                url: `/graphql?access_token=${TEST_TOKEN}`,
                headers: { 'content-type': 'application/json' },
                payload: JSON.stringify({ query: '{ lastHeartbeat { id } }' }),
            });
            assert.strictEqual(response.statusCode, 401);
        });

        it('should not expose the endpoint over GET', async () => {
            const response = await fastify.inject({
                method: 'GET',
                url: '/graphql?query=%7BlastHeartbeat%7Bid%7D%7D',
                headers: { authorization: `Bearer ${TEST_TOKEN}` },
            });
            assert.strictEqual(response.statusCode, 404);
        });
    });

    describe('Queries', () => {
        it('should return the last heartbeat with camelCase fields', async () => {
            const response = await query({
                query: '{ lastHeartbeat { id status timestamp tempCpu bytesDown bandwidthDown } }',
            });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(response.headers['cache-control'], 'no-store');
            assert.deepStrictEqual(response.body.data, {
                lastHeartbeat: {
                    id: '42',
                    status: 'up',
                    timestamp: '2026-01-01T12:00:00.000Z',
                    tempCpu: 55,
                    bytesDown: 9007199254740,
                    bandwidthDown: 8000000000,
                },
            });
        });

        it('should return a heartbeat by ID and null for unknown IDs', async () => {
            const response = await query({
                query: '{ found: heartbeat(id: "42") { id } missing: heartbeat(id: "1") { id } }',
            });

            assert.strictEqual(response.statusCode, 200);
            assert.deepStrictEqual(response.body.data, { found: { id: '42' }, missing: null });
        });

        it('should reject non-numeric heartbeat IDs', async () => {
            const response = await query({ query: '{ heartbeat(id: "abc") { id } }' });

            assert.strictEqual(response.statusCode, 200);
            assert.strictEqual(
                response.body.errors?.[0].message,
                '"id" must be a positive integer'
            );
        });

        it('should pass pagination arguments and variables to the service', async () => {
            heartbeatPageCalls.length = 0;
            const response = await query({
                query: 'query Range($from: DateTime!, $to: DateTime!) { heartbeats(from: $from, to: $to, limit: 10, offset: 20) { id } }',
                variables: { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' },
            });

            assert.strictEqual(response.statusCode, 200);
            assert.deepStrictEqual(response.body.data, { heartbeats: [{ id: '42' }] });
            assert.strictEqual(heartbeatPageCalls.length, 1);
            assert.strictEqual(
                heartbeatPageCalls[0].from.toISOString(),
                '2026-01-01T00:00:00.000Z'
            );
            assert.strictEqual(heartbeatPageCalls[0].limit, 10);
            assert.strictEqual(heartbeatPageCalls[0].offset, 20);
        });

        it('should return downtimes', async () => {
            const response = await query({
                query: '{ activeDowntime { id startedAt endedAt isActive } downtimes(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z") { id duration } }',
            });

            assert.strictEqual(response.statusCode, 200);
            assert.deepStrictEqual(response.body.data, {
                activeDowntime: {
                    id: '7',
                    startedAt: '2026-01-01T10:00:00.000Z',
                    endedAt: null,
                    isActive: true,
                },
                downtimes: [{ id: '7', duration: null }],
            });
        });
    });

    describe('Sensitive data', () => {
        for (const field of ['ipv4', 'ipv6', 'activeDevices', 'metadata']) {
            it(`should not expose heartbeat field "${field}"`, async () => {
                const response = await query({ query: `{ lastHeartbeat { ${field} } }` });
                assert.strictEqual(response.statusCode, 400);
                assert.strictEqual(response.body.data, undefined);
            });
        }

        it('should not expose downtime notes', async () => {
            const response = await query({ query: '{ activeDowntime { notes } }' });
            assert.strictEqual(response.statusCode, 400);
        });

        it('should not suggest field names in validation errors', async () => {
            const response = await query({ query: '{ lastHeartbeat { ipv } }' });
            assert.strictEqual(response.statusCode, 400);
            assert.ok(!response.body.errors?.[0].message.includes('Did you mean'));
        });

        it('should never leak sensitive values in any response', async () => {
            const response = await fastify.inject({
                method: 'POST',
                url: '/graphql',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${TEST_TOKEN}`,
                },
                payload: JSON.stringify({
                    query: '{ lastHeartbeat { id status mediaState connectionType connectedDevicesTotal } }',
                }),
            });

            for (const secret of ['203.0.113.42', '2001:db8::42', 'AA:BB:CC', 'secret-laptop']) {
                assert.ok(!response.body.includes(secret), `Response leaks "${secret}"`);
            }
        });

        it('should disable introspection', async () => {
            const response = await query({ query: '{ __schema { types { name } } }' });
            assert.strictEqual(response.statusCode, 400);
        });

        it('should mask internal errors', async () => {
            failNextQuery = true;
            const response = await query({ query: '{ lastHeartbeat { id } }' });

            assert.strictEqual(response.statusCode, 200);
            assert.deepStrictEqual(response.body.data, { lastHeartbeat: null });
            assert.strictEqual(response.body.errors?.[0].message, 'Internal server error');
            assert.ok(!JSON.stringify(response.body).includes('SQL'));
        });
    });

    describe('Query limits', () => {
        it('should reject mutations', async () => {
            const response = await query({ query: 'mutation { lastHeartbeat { id } }' });
            assert.strictEqual(response.statusCode, 400);
        });

        it(`should reject a limit greater than ${MAX_PAGE_SIZE}`, async () => {
            const response = await query({
                query: `{ heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", limit: ${MAX_PAGE_SIZE + 1}) { id } }`,
            });
            assert.strictEqual(
                response.body.errors?.[0].message,
                `"limit" must be between 1 and ${MAX_PAGE_SIZE}`
            );
        });

        it('should reject a negative offset', async () => {
            const response = await query({
                query: '{ heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", offset: -1) { id } }',
            });
            assert.strictEqual(
                response.body.errors?.[0].message,
                '"offset" must be greater than or equal to 0'
            );
        });

        it('should reject an inverted date range', async () => {
            const response = await query({
                query: '{ downtimes(from: "2026-01-02T00:00:00Z", to: "2026-01-01T00:00:00Z") { id } }',
            });
            assert.strictEqual(
                response.body.errors?.[0].message,
                '"from" must be earlier than or equal to "to"'
            );
        });

        it('should reject invalid DateTime values', async () => {
            const response = await query({
                query: '{ heartbeats(from: "not-a-date", to: "2026-01-01T00:00:00Z") { id } }',
            });
            assert.strictEqual(response.statusCode, 400);
        });

        it('should reject operations with too many root fields', async () => {
            const aliases = Array.from({ length: 11 }, (_, i) => `a${i}: lastHeartbeat { id }`);
            const response = await query({ query: `{ ${aliases.join(' ')} }` });

            assert.strictEqual(response.statusCode, 400);
            assert.strictEqual(
                response.body.errors?.[0].message,
                'Operation selects 11 root fields, maximum allowed is 10'
            );
        });

        it('should count root fields selected through fragments', async () => {
            const aliases = Array.from({ length: 6 }, (_, i) => `a${i}: lastHeartbeat { id }`);
            const response = await query({
                query: `{ ...Q ... on Query { ${aliases.join(' ')} } } fragment Q on Query { ${aliases.map((a) => `b${a}`).join(' ')} }`,
            });

            assert.strictEqual(response.statusCode, 400);
            assert.match(response.body.errors?.[0].message ?? '', /12 root fields/);
        });

        it('should reject nested aliases amplified by a reused fragment', async () => {
            const callsBefore = heartbeatPageCalls.length;
            const heartbeats = Array.from(
                { length: 10 },
                (_, i) =>
                    `h${i}: heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", limit: 1000) { ...F }`
            );
            const ids = Array.from({ length: 250 }, (_, i) => `a${i}: id`);
            const response = await query({
                query: `{ ${heartbeats.join(' ')} } fragment F on Heartbeat { ${ids.join(' ')} }`,
            });

            assert.strictEqual(response.statusCode, 400);
            assert.match(response.body.errors?.[0].message ?? '', /^Operation cost is 2500010,/);
            assert.strictEqual(heartbeatPageCalls.length, callsBefore);
        });

        it('should take the limit supplied through a variable into account', async () => {
            const callsBefore = heartbeatPageCalls.length;
            const ids = Array.from({ length: 150 }, (_, i) => `a${i}: id`);
            const response = await query({
                query: `query ($limit: Int!) { heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", limit: $limit) { ${ids.join(' ')} } }`,
                variables: { limit: 1000 },
            });

            assert.strictEqual(response.statusCode, 400);
            assert.match(response.body.errors?.[0].message ?? '', /^Operation cost is 150001,/);
            assert.strictEqual(heartbeatPageCalls.length, callsBefore);
        });

        it('should compute the cost of exponentially nested fragments in bounded time', async () => {
            const depth = 40;
            const fragments = Array.from({ length: depth }, (_, i) =>
                i === depth - 1
                    ? `fragment F${i} on Heartbeat { id }`
                    : `fragment F${i} on Heartbeat { ...F${i + 1} ...F${i + 1} }`
            );
            const startedAt = Date.now();
            const response = await query({
                query: `{ heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", limit: 1000) { ...F0 } } ${fragments.join(' ')}`,
            });

            assert.strictEqual(response.statusCode, 400);
            assert.match(response.body.errors?.[0].message ?? '', /^Operation cost is /);
            assert.ok(Date.now() - startedAt < 2000);
        });

        it('should accept a full page of heartbeats within the cost budget', async () => {
            const response = await query({
                query: '{ heartbeats(from: "2026-01-01T00:00:00Z", to: "2026-01-02T00:00:00Z", limit: 1000) { id status timestamp rateDown rateUp } }',
            });

            assert.strictEqual(response.statusCode, 200);
        });

        it('should reject documents with too many tokens', async () => {
            const fields = Array.from({ length: 1000 }, () => 'id').join(' ');
            const response = await query({ query: `{ lastHeartbeat { ${fields} } }` });
            assert.strictEqual(response.statusCode, 400);
        });

        it('should reject non-JSON bodies', async () => {
            const response = await fastify.inject({
                method: 'POST',
                url: '/graphql',
                headers: {
                    'content-type': 'text/plain',
                    authorization: `Bearer ${TEST_TOKEN}`,
                },
                payload: '{ lastHeartbeat { id } }',
            });
            assert.strictEqual(response.statusCode, 400);
        });
    });
});

describe('GraphQL configuration', () => {
    it('should fail when the token hash is missing', () => {
        assert.throws(
            () => loadGraphqlConfig({ GRAPHQL_ENABLED: 'true' }),
            /GRAPHQL_API_TOKEN_HASH must be a 64-character hexadecimal SHA-256 digest/
        );
    });

    it('should fail when the token hash is malformed', () => {
        assert.throws(
            () => loadGraphqlConfig({ GRAPHQL_API_TOKEN_HASH: 'not-a-hash' }),
            /GRAPHQL_API_TOKEN_HASH/
        );
    });

    it('should fail when the token is the API secret', () => {
        const apiSecret = 'test-secret-32-chars-for-graphql-tests!!';
        assert.throws(
            () =>
                loadGraphqlConfig({
                    API_SECRET: apiSecret,
                    GRAPHQL_API_TOKEN_HASH: hashToken(apiSecret).toString('hex'),
                }),
            /must differ from API_SECRET/
        );
    });

    it('should fail when the rate limit is invalid', () => {
        assert.throws(
            () =>
                loadGraphqlConfig({
                    GRAPHQL_API_TOKEN_HASH: TEST_TOKEN_HASH,
                    GRAPHQL_RATE_LIMIT: 'abc',
                }),
            /GRAPHQL_RATE_LIMIT must be an integer between 1 and 10000/
        );
    });

    it('should default the rate limit to 60 requests per minute', () => {
        const config = loadGraphqlConfig({ GRAPHQL_API_TOKEN_HASH: TEST_TOKEN_HASH.toUpperCase() });
        assert.strictEqual(config.rateLimitMax, 60);
        assert.ok(config.tokenHash.equals(hashToken(TEST_TOKEN)));
    });
});

describe('GraphQL application wiring', () => {
    const envKeys = [
        'API_SECRET',
        'NODE_ENV',
        'GRAPHQL_ENABLED',
        'GRAPHQL_API_TOKEN_HASH',
        'GRAPHQL_RATE_LIMIT',
    ];
    const originalEnv: Record<string, string | undefined> = {};

    before(() => {
        for (const key of envKeys) {
            originalEnv[key] = process.env[key];
        }
        process.env.API_SECRET = 'test-secret-32-chars-for-graphql-tests!!';
        // Use production mode to avoid pino-pretty worker threads (see smoke tests)
        process.env.NODE_ENV = 'production';
    });

    after(() => {
        for (const key of envKeys) {
            if (originalEnv[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = originalEnv[key];
            }
        }
    });

    it('should not register the endpoint when GRAPHQL_ENABLED is not set', async () => {
        delete process.env.GRAPHQL_ENABLED;
        const app = await createApp({ rateLimitMax: 1000 });

        try {
            const response = await app.inject({
                method: 'POST',
                url: `${API_PREFIX}/graphql`,
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${TEST_TOKEN}`,
                },
                payload: JSON.stringify({ query: '{ lastHeartbeat { id } }' }),
            });
            assert.strictEqual(response.statusCode, 404);
        } finally {
            await app.close();
        }
    });

    it('should refuse to start when enabled without a token hash', async () => {
        process.env.GRAPHQL_ENABLED = 'true';
        delete process.env.GRAPHQL_API_TOKEN_HASH;

        await assert.rejects(() => createApp(), /GRAPHQL_API_TOKEN_HASH/);
    });

    it('should register the endpoint with its own rate limit when enabled', async () => {
        process.env.GRAPHQL_ENABLED = 'true';
        process.env.GRAPHQL_API_TOKEN_HASH = TEST_TOKEN_HASH;
        process.env.GRAPHQL_RATE_LIMIT = '2';
        const app = await createApp({ rateLimitMax: 1000 });

        try {
            const send = (): Promise<LightMyRequestResponse> =>
                app.inject({
                    method: 'POST',
                    url: `${API_PREFIX}/graphql`,
                    headers: { 'content-type': 'application/json' },
                    payload: JSON.stringify({ query: '{ lastHeartbeat { id } }' }),
                });

            const first = await send();
            assert.strictEqual(first.statusCode, 401);
            assert.strictEqual(first.headers['x-ratelimit-limit'], '2');

            await send();
            const third = await send();
            assert.strictEqual(third.statusCode, 429);
        } finally {
            await app.close();
        }
    });
});
