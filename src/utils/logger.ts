import pino from 'pino';
import { createStream } from 'rotating-file-stream';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Ensure logs directory exists.
 * Returns the directory path on success, or null if creation fails.
 */
function ensureLogsDirectory(): string | null {
    try {
        const logsDir = join(process.cwd(), 'logs');
        if (!existsSync(logsDir)) {
            mkdirSync(logsDir, { recursive: true });
        }
        return logsDir;
    } catch (error) {
        console.error('Failed to create logs directory:', error);
        return null;
    }
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
 *             Falls back to console-only if file logging cannot be initialized
 */
function createApplicationLogger(): pino.Logger {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const logLevel = getLogLevel();

    if (isDevelopment) {
        // Development: console with pino-pretty for better readability
        return pino({
            level: logLevel,
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

    // Production: attempt to set up file rotation
    const logsDir = ensureLogsDirectory();

    const baseConfig = {
        level: logLevel,
        formatters: {
            level: (label: string) => {
                return { level: label };
            },
        },
    };

    if (logsDir === null) {
        // Failed to create logs directory, fall back to console-only logging
        console.warn('File logging disabled due to logs directory creation failure');
        return pino(baseConfig, process.stdout);
    }

    // Set up rotating file stream
    const fileStream = createStream('app.log', {
        interval: '1d', // Rotate daily
        maxFiles: 30, // Keep 30 days of logs
        path: logsDir,
        compress: 'gzip', // Compress rotated logs
    });

    return pino(baseConfig, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));
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
