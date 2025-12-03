import type { Knex } from 'knex';

/**
 * Add detailed heartbeat columns
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.string('token', 255).nullable();
        table.string('ipv4', 45).nullable();
        table.string('ipv6', 45).nullable();
        table.string('media_state', 50).nullable();
        table.string('connection_type', 50).nullable();
        table.bigInteger('bandwidth_down').nullable();
        table.bigInteger('bandwidth_up').nullable();
        table.bigInteger('rate_down').nullable();
        table.bigInteger('rate_up').nullable();
        table.bigInteger('bytes_down').nullable();
        table.bigInteger('bytes_up').nullable();
    });
}

/**
 * Remove detailed heartbeat columns
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.dropColumn('token');
        table.dropColumn('ipv4');
        table.dropColumn('ipv6');
        table.dropColumn('media_state');
        table.dropColumn('connection_type');
        table.dropColumn('bandwidth_down');
        table.dropColumn('bandwidth_up');
        table.dropColumn('rate_down');
        table.dropColumn('rate_up');
        table.dropColumn('bytes_down');
        table.dropColumn('bytes_up');
    });
}
