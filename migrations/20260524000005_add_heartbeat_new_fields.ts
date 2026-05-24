import type { Knex } from 'knex';

/**
 * Add new heartbeat payload fields (connected devices, FTTH optics, system health)
 */
export async function up(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.integer('connected_devices_total').nullable();
        table.integer('connected_devices_wifi').nullable();
        table.float('sfp_pwr_rx_dbm').nullable();
        table.float('sfp_pwr_tx_dbm').nullable();
        table.integer('temp_cpu').nullable();
        table.integer('temp_switch').nullable();
        table.integer('fan_rpm').nullable();
        table.bigInteger('uptime').nullable();
    });
}

/**
 * Remove new heartbeat payload fields
 */
export async function down(knex: Knex): Promise<void> {
    await knex.schema.alterTable('heartbeats', (table) => {
        table.dropColumn('connected_devices_total');
        table.dropColumn('connected_devices_wifi');
        table.dropColumn('sfp_pwr_rx_dbm');
        table.dropColumn('sfp_pwr_tx_dbm');
        table.dropColumn('temp_cpu');
        table.dropColumn('temp_switch');
        table.dropColumn('fan_rpm');
        table.dropColumn('uptime');
    });
}
