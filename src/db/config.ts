import 'dotenv/config';
import knex, { type Knex } from 'knex';

/**
 * Database configuration for Knex.js
 */
const config: Knex.Config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number.parseInt(process.env.DB_PORT ?? '3306', 10),
        user: process.env.DB_USER || 'freebox_watcher',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'freebox_watcher',
    },
    pool: {
        min: 2,
        max: 10,
    },
    migrations: {
        tableName: 'knex_migrations',
    },
};

/**
 * Create and export database instance
 */
export const db: Knex = knex(config);

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
    try {
        await db.raw('SELECT 1');
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Database connection failed: ${message}`);
    }
}

/**
 * Close database connection
 */
export async function closeConnection(): Promise<void> {
    await db.destroy();
}

export default config;
