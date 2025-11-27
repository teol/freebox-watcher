import 'dotenv/config';
import knex, { type Knex } from 'knex';
import knexConfig from '../../knexfile.js';

/**
 * Create and export database instance
 */
export const db: Knex = knex(knexConfig);

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
