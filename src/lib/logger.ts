import 'server-only';

import pino from 'pino';

/**
 * Structured logger using Pino.
 *
 * Dev: pretty printed to console
 * Prod: JSON lines to stdout (for log aggregation)
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info({ userId, model }, 'chat request started');
 *   logger.error({ err, userId }, 'chat generation failed');
 */

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  // Add default bindings
  base: {
    service: 'aichat',
    env: process.env.NODE_ENV ?? 'development',
  },
  // Redact sensitive fields
  redact: {
    paths: [
      '*.password',
      '*.secret',
      '*.key',
      '*.token',
      '*.authorization',
      '*.cookie',
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
    censor: '[REDACTED]',
  },
});

/** Create a child logger with additional context. */
export function createChildLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

/** Log an error with standardized fields. */
export function logError(logger: pino.Logger, error: unknown, context: Record<string, unknown> = {}) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error({ err: { message: err.message, stack: err.stack, name: err.name }, ...context });
}

/** Log an info message with context. */
export function logInfo(logger: pino.Logger, message: string, context: Record<string, unknown> = {}) {
  logger.info(context, message);
}

/** Log a warning message with context. */
export function logWarn(logger: pino.Logger, message: string, context: Record<string, unknown> = {}) {
  logger.warn(context, message);
}

export default logger;