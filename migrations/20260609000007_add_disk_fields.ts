import type { Knex } from 'knex';

/**
 * Add disk health fields to heartbeats table
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.integer('disk_temp').nullable();
        table.bigInteger('disk_used_bytes').nullable();
        table.bigInteger('disk_free_bytes').nullable();
        table.bigInteger('disk_total_bytes').nullable();
        table.integer('disk_read_errors').nullable();
        table.integer('disk_write_errors').nullable();
    });
}

/**
 * Remove disk health fields from heartbeats table
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.dropColumn('disk_temp');
        table.dropColumn('disk_used_bytes');
        table.dropColumn('disk_free_bytes');
        table.dropColumn('disk_total_bytes');
        table.dropColumn('disk_read_errors');
        table.dropColumn('disk_write_errors');
    });
}
