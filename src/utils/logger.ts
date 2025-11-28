import pino from 'pino';
import type { LoggerOptions } from 'pino';

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
        return {
            ...baseOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
                    ignore: 'pid,hostname',
                    singleLine: false,
                    messageFormat: '{levelLabel} {msg}',
                    customColors:
                        'fatal:bgRed,error:red,warn:yellow,info:green,debug:blue,trace:gray',
                    customLevels: 'fatal:60,error:50,warn:40,info:30,debug:20,trace:10',
                    useOnlyCustomProps: false,
                },
            },
        };
    }

    return baseOptions;
}

/**
 * Create a root logger instance
 */
export function createLogger(): pino.Logger {
    return pino(createLoggerOptions());
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
