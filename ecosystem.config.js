export default {
    apps: [
        {
            name: 'freebox-watcher',
            script: './dist/src/index.js',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            watch: false,
            max_memory_restart: '500M',
            node_args: '--enable-source-maps',
            env: {
                NODE_ENV: 'production',
            },
            error_file: './logs/pm2-error.log',
            out_file: './logs/pm2-out.log',
            log_file: './logs/pm2-combined.log',
            time: true,
            merge_logs: true,
            log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000,
        },
    ],
};
