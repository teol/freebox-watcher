import pino from 'pino';
import type { LoggerOptions, TransportTargetOptions } from 'pino';
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
 * Create Pino logger configuration with pretty printing for development
 * and file rotation for production
 */
export function createLoggerOptions(): LoggerOptions {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    const baseOptions: LoggerOptions = {
        level: getLogLevel(),
        formatters: {
            level: (label) => {
                return { level: label };
            },
        },
    };

    if (isDevelopment) {
        // Development: pretty console output only
        return {
            ...baseOptions,
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
        };
    }

    // Production: file logging with rotation + console output
    const targets: TransportTargetOptions[] = [
        {
            target: 'pino/file',
            level: getLogLevel(),
            options: {
                destination: 1, // stdout for container logs
            },
        },
    ];

    return {
        ...baseOptions,
        transport: {
            targets,
        },
    };
}

/**
 * Create a root logger instance with optional file rotation stream
 */
export function createLogger(): pino.Logger {
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (isDevelopment) {
        // Development: use simple configuration
        return pino(createLoggerOptions());
    }

    // Production: add file rotation stream
    const logsDir = ensureLogsDirectory();

    // Create rotating file stream
    const fileStream = createStream('app.log', {
        interval: '1d', // Rotate daily
        maxFiles: 30, // Keep 30 days of logs
        path: logsDir,
        compress: 'gzip', // Compress rotated logs
    });

    // Create multistream: console + rotating file
    const streams = [{ stream: process.stdout }, { stream: fileStream }];

    return pino(
        {
            level: getLogLevel(),
            formatters: {
                level: (label) => {
                    return { level: label };
                },
            },
        },
        pino.multistream(streams)
    );
}

/**
 * Create a child logger with specific context
 * @param parent Parent logger instance
 * @param context Context object to bind to the child logger
 * @returns Child logger with bound context
 */
export function createChildLogger(
    parent: pino.Logger,
    context: Record<string, unknown>
): pino.Logger {
    return parent.child(context);
}

/**
 * Default logger instance for use outside of Fastify
 */
export const logger = createLogger();
