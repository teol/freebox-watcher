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
 * Create shared pino-pretty transport configuration for pretty-printed logs.
 * Used in both development and production environments for better readability.
 */
function createPrettyTransport(colorize: boolean): pino.TransportSingleOptions {
    return {
        target: 'pino-pretty',
        options: {
            colorize,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
            customColors: 'fatal:bgRed,error:red,warn:yellow,info:green,debug:blue,trace:gray',
        },
    };
}

/**
 * Get base Pino logger configuration.
 * This shared configuration is used by both Fastify and standalone scripts.
 *
 * Development: Pretty-printed colored console output
 * Production: Structured JSON logging for easier parsing by log aggregation services
 */
function getBaseLoggerOptions(): pino.LoggerOptions {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const logLevel = getLogLevel();

    if (isDevelopment) {
        const enableColors = process.env.LOG_COLORS !== 'false';
        return {
            level: logLevel,
            transport: createPrettyTransport(enableColors),
        };
    }

    // For production, return a base config for JSON logging.
    return {
        level: logLevel,
        formatters: {
            level: (label: string) => {
                return { level: label };
            },
        },
    };
}

/**
 * Get Pino logger options for Fastify.
 * This returns configuration that Fastify v5 can use to create its logger.
 *
 * Development: Pretty-printed colored console output (set LOG_COLORS=false to disable)
 * Production: Structured JSON logging
 */
export function getLoggerOptions(): pino.LoggerOptions {
    return getBaseLoggerOptions();
}

/**
 * Create and configure the application logger instance for standalone scripts.
 * This single instance is used in scripts that don't use Fastify.
 *
 * Development: Pretty-printed colored console output
 * Production: JSON logging with optional file rotation
 *             Falls back to console-only if file logging cannot be initialized
 *
 * Note: File rotation is only attempted in production and requires write access to ./logs
 */
function createApplicationLogger(): pino.Logger {
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const config = getBaseLoggerOptions();

    if (isDevelopment) {
        return pino(config);
    }

    // Production logging (JSON)
    const logsDir = ensureLogsDirectory();

    if (logsDir === null) {
        // Fallback to console-only logging
        console.warn('File logging disabled due to logs directory creation failure');
        return pino(config);
    }

    // Set up rotating file stream for production logs
    const fileStream = createStream('app.log', {
        interval: '1d', // Rotate daily
        maxFiles: 30, // Keep 30 days of logs
        path: logsDir,
        compress: 'gzip', // Compress rotated logs
    });

    return pino(config, pino.multistream([{ stream: process.stdout }, { stream: fileStream }]));
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
