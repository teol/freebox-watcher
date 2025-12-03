import type { Knex } from 'knex';

/**
 * Remove obsolete token column from heartbeats
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.dropColumn('token');
    });
}

/**
 * Restore token column on rollback
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.string('token', 255).nullable();
    });
}
