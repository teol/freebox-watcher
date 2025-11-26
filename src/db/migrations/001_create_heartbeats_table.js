/**
 * Create heartbeats table
 */
export async function up(knex) {
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
export async function down(knex) {
    await knex.schema.dropTableIfExists('heartbeats');
}
