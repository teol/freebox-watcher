import 'dotenv/config';
import { db } from './config.js';
import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runMigrations() {
    try {
        console.log('Starting database migrations...');

        // Create migrations table if it doesn't exist
        const hasTable = await db.schema.hasTable('knex_migrations');
        if (!hasTable) {
            await db.schema.createTable('knex_migrations', (table) => {
                table.increments('id').primary();
                table.string('name').notNullable();
                table.timestamp('migration_time').defaultTo(db.fn.now());
            });
        }

        // Get all migration files
        const migrationsDir = join(__dirname, 'migrations');
        const files = await readdir(migrationsDir);
        const migrationFiles = files.filter((f) => f.endsWith('.js')).sort();

        // Get already run migrations
        const completedMigrations = await db('knex_migrations').select('name');
        const completedNames = completedMigrations.map((m) => m.name);

        // Run pending migrations
        for (const file of migrationFiles) {
            if (!completedNames.includes(file)) {
                console.log(`Running migration: ${file}`);
                const migrationPath = join(migrationsDir, file);
                const migration = await import(migrationPath);

                await migration.up(db);
                await db('knex_migrations').insert({ name: file });
                console.log(`✓ Migration completed: ${file}`);
            } else {
                console.log(`⊘ Migration already run: ${file}`);
            }
        }

        console.log('All migrations completed successfully!');
        await db.destroy();
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        await db.destroy();
        process.exit(1);
    }
}

runMigrations();
