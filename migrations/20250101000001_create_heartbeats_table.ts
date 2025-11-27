import type { Knex } from 'knex';

/**
 * Create heartbeats table
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.createTable('heartbeats', (table) => {
        table.increments('id').primary();
        table.string('status', 50).notNullable();
        table.timestamp('timestamp').notNullable();
        table.timestamp('received_at').defaultTo(knex.fn.now());
        table.json('metadata').nullable();
        table.index(['timestamp']);
        table.index(['received_at']);
    });
}

/**
 * Drop heartbeats table
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.dropTableIfExists('heartbeats');
}
