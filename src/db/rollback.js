import 'dotenv/config';
import { db } from './config.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function rollbackLastMigration() {
    try {
        console.log('Rolling back last migration...');

        // Check if migrations table exists
        const hasTable = await db.schema.hasTable('knex_migrations');
        if (!hasTable) {
            console.log('No migrations to rollback.');
            await db.destroy();
            process.exit(0);
        }

        // Get last migration
        const lastMigration = await db('knex_migrations').orderBy('id', 'desc').first();

        if (!lastMigration) {
            console.log('No migrations to rollback.');
            await db.destroy();
            process.exit(0);
        }

        console.log(`Rolling back: ${lastMigration.name}`);

        // Load and run the down migration
        const migrationPath = join(__dirname, 'migrations', lastMigration.name);
        const migration = await import(migrationPath);

        await migration.down(db);
        await db('knex_migrations').where('id', lastMigration.id).delete();

        console.log(`✓ Rollback completed: ${lastMigration.name}`);
        await db.destroy();
        process.exit(0);
    } catch (error) {
        console.error('Rollback failed:', error);
        await db.destroy();
        process.exit(1);
    }
}

rollbackLastMigration();
