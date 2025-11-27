import type { Knex } from 'knex';

/**
 * Create heartbeats table
 */
export async function up(knexInstance: Knex): Promise<void> {
    await knexInstance.schema.createTable('heartbeats', (table) => {
        table.increments('id').primary();
        table.string('status', 50).notNullable();
        table.timestamp('timestamp').notNullable();
        table.timestamp('received_at').defaultTo(knexInstance.fn.now());
        table.json('metadata').nullable();
        table.index(['timestamp']);
        table.index(['received_at']);
    });
}

/**
 * Drop heartbeats table
 */
export async function down(knexInstance: Knex): Promise<void> {
    await knexInstance.schema.dropTableIfExists('heartbeats');
}
