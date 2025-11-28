import pino from 'pino';
import { createStream } from 'rotating-file-stream';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensure logs directory exists
 */
function ensureLogsDirectory(): string {
    const logsDir = join(process.cwd(), 'logs');
    if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
    }
    return logsDir;
}

/**
 * Get the log level from environment or default to 'info'
 */
function getLogLevel(): pino.Level {
    const level = process.env.LOG_LEVEL?.toLowerCase() || 'info';
    const validLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];
    return validLevels.includes(level) ? (level as pino.Level) : 'info';
}

/**
 * Create and configure the application logger instance.
 * This single instance is used throughout the application (Fastify, services, etc.)
 * to ensure consistent logging behavior.
 *
 * Development: Pretty-printed console output
 * Production: JSON logs to both console (stdout) and rotating file
 */
function createApplicationLogger(): pino.Logger {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (isDevelopment) {
        // Development: console with pino-pretty for better readability
        return pino({
            level: getLogLevel(),
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
                    ignore: 'pid,hostname',
                    customColors:
                        'fatal:bgRed,error:red,warn:yellow,info:green,debug:blue,trace:gray',
                },
            },
        });
    }

    // Production: multistream to both console and rotating file
    const logsDir = ensureLogsDirectory();

    const fileStream = createStream('app.log', {
        interval: '1d', // Rotate daily
        maxFiles: 30, // Keep 30 days of logs
        path: logsDir,
        compress: 'gzip', // Compress rotated logs
    });

    return pino(
        {
            level: getLogLevel(),
            formatters: {
                level: (label) => {
                    return { level: label };
                },
            },
        },
        pino.multistream([{ stream: process.stdout }, { stream: fileStream }])
    );
}

/**
 * Shared logger instance used throughout the application.
 * Import this instance in your code to ensure consistent logging.
 */
export const logger = createApplicationLogger();

/**
 * Default export for convenience
 */
export default logger;
