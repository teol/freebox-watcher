import type { Knex } from 'knex';

/**
 * Create downtime_events table
 */
export async function up(knexInstance: Knex): Promise<void> {
    await knexInstance.schema.createTable('downtime_events', (table) => {
        table.increments('id').primary();
        table.timestamp('started_at').notNullable();
        table.timestamp('ended_at').nullable();
        table.integer('duration').nullable().comment('Duration in seconds');
        table.boolean('is_active').defaultTo(true);
        table.text('notes').nullable();
        table.index(['started_at']);
        table.index(['is_active']);
    });
}

/**
 * Drop downtime_events table
 */
export async function down(knexInstance: Knex): Promise<void> {
    await knexInstance.schema.dropTableIfExists('downtime_events');
}
