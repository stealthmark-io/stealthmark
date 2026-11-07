import pino from 'pino'

export interface LoggerOptions {
  level?: string
  service?: string
}

export function createLogger(options: LoggerOptions = {}) {
  const { level = process.env.LOG_LEVEL || 'info', service = 'stealthmark' } = options

  return pino({
    level,
    base: {
      service,
      env: process.env.NODE_ENV || 'development',
    },
    transport:
      process.env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
  })
}

export type Logger = ReturnType<typeof createLogger>
