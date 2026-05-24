import type { Knex } from 'knex';

/**
 * Add active_devices JSON column to heartbeats and create devices registry table
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.json('active_devices').nullable();
    });

    await knex.schema.createTable('devices', (table) => {
        table.increments('id').primary();
        table.string('mac', 17).notNullable().unique();
        table.string('name', 255).notNullable();
        table.string('type', 50).notNullable();
        table.timestamp('first_seen_at').notNullable();
        table.timestamp('last_seen_at').notNullable();
        table.index(['last_seen_at']);
    });
}

/**
 * Drop devices table and remove active_devices column from heartbeats
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('devices');

    await knex.schema.alterTable('heartbeats', (table) => {
        table.dropColumn('active_devices');
    });
}
