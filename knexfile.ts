import 'dotenv/config';
import type { Knex } from 'knex';

const config: Knex.Config = {
    client: 'mysql2',
    connection: {
        host: process.env.DB_HOST || 'localhost',
        port: Number.parseInt(process.env.DB_PORT ?? '3306', 10),
        user: process.env.DB_USER || 'freebox_watcher',
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'freebox_watcher',
    },
    pool: {
        min: 2,
        max: 10,
    },
    migrations: {
        tableName: 'knex_migrations',
        directory: './migrations',
        extension: 'ts',
        loadExtensions: ['.ts'],
    },
};

export default config;
