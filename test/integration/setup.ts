import { db } from '../../src/db/config.js';
import type { HeartbeatsInsert } from '../../src/types/database.js';

/**
 * Shared helpers for the integration tests, which run against a real MariaDB database
 * whose schema has been created beforehand with `yarn db:migrate`.
 */

const TABLES = ['heartbeats', 'devices', 'downtime_events'];

/**
 * Ensure the tests run against a dedicated database, since every test wipes the tables
 */
export async function setupDatabase(): Promise<void> {
    const database = process.env.DB_NAME ?? '';
    if (!database.endsWith('_test')) {
        throw new Error(
            `Refusing to run integration tests against database '${database}': DB_NAME must end with '_test'`
        );
    }

    const [rows] = (await db.raw('SELECT COUNT(*) AS applied FROM knex_migrations')) as [
        Array<{ applied: number }>,
    ];
    if (rows[0].applied === 0) {
        throw new Error('Database schema is missing: run `yarn db:migrate` before the tests');
    }
}

/**
 * Empty every application table
 */
export async function resetDatabase(): Promise<void> {
    for (const table of TABLES) {
        await db(table).truncate();
    }
}

/**
 * Close the connection pool so that the test process can exit
 */
export async function teardownDatabase(): Promise<void> {
    await db.destroy();
}

/**
 * Insert heartbeats directly, bypassing the service
 */
export async function insertHeartbeats(heartbeats: HeartbeatsInsert[]): Promise<void> {
    await db('heartbeats').insert(heartbeats);
}
