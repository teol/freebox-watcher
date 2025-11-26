import 'dotenv/config';
import knex from 'knex';

/**
 * Database configuration for Knex.js
 */
const config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
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
export const db = knex(config);

/**
 * Test database connection
 */
export async function testConnection() {
    try {
        await db.raw('SELECT 1');
        return true;
    } catch (error) {
        throw new Error(`Database connection failed: ${error.message}`);
    }
}

/**
 * Close database connection
 */
export async function closeConnection() {
    await db.destroy();
}

export default config;
