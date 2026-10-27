import { z } from 'zod'

import type { Config } from '#config'
import { ConfigurationError } from '#errors'

export const serverVariables: Config = {
  HEDRA_SERVER_ENV: {
    name: 'serverEnv',
    default: 'dev',
    options: ['test', 'dev', 'nonprod', 'prod'],
    description: 'The environment the server is running in (development, non-production, or production)',
    validate: (value: string | number | boolean) => {
      try {
        z.enum(['test', 'dev', 'nonprod', 'prod']).parse(value)
      } catch (_error) {
        throw new ConfigurationError(500, 'configuration error', `HEDRA_SERVER_ENV has invalid value: ${value}`)
      }
    },
  },
  HEDRA_SERVER_SILENT_STARTUP: {
    name: 'serverSilentStartup',
    default: 'false',
    options: ['true', 'false'],
    description: 'Whether to suppress the startup message',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.boolean().parse(value)
      } catch (_error) {
        throw new ConfigurationError(
          500,
          'configuration error',
          `HEDRA_SERVER_SILENT_STARTUP has invalid value: ${value}`,
        )
      }
    },
  },
  HEDRA_SERVER_LOG_TYPE: {
    name: 'serverLogType',
    default: 'pino',
    options: ['pino', 'pino-pretty', 'dev'],
    description: 'The logging library to use for server logging',
    validate: (value: string | number | boolean) => {
      try {
        z.enum(['pino', 'pino-pretty', 'dev']).parse(value)
      } catch (_error) {
        throw new ConfigurationError(500, 'configuration error', `HEDRA_SERVER_LOG_TYPE has invalid value: ${value}`)
      }
    },
  },
  HEDRA_SERVER_LOG_LEVEL: {
    name: 'serverLogLevel',
    default: 'info',
    options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'],
    description: 'The minimum log level to output (trace being most verbose, silent being no output)',
    validate: (value: string | number | boolean) => {
      try {
        z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).parse(value)
      } catch (_error) {
        throw new ConfigurationError(500, 'configuration error', `HEDRA_SERVER_LOG_LEVEL has invalid value: ${value}`)
      }
    },
  },
  HEDRA_SERVER_HTTP_LOGGING: {
    name: 'serverHttpLogEnabled',
    default: 'true',
    options: ['true', 'false'],
    description: 'Enable or disable HTTP request/response logging',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.boolean().parse(value)
      } catch (_error) {
        throw new ConfigurationError(
          500,
          'configuration error',
          `HEDRA_SERVER_HTTP_LOGGING has invalid value: ${value}`,
        )
      }
    },
  },
  HEDRA_SERVER_PORT: {
    name: 'serverPort',
    default: 3000,
    options: 'Integer value from 1 to 65535',
    description: 'The port the server listens on',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.number().int().min(1).max(65535).parse(value)
      } catch (_error) {
        throw new ConfigurationError(500, 'configuration error', `HEDRA_SERVER_PORT has invalid value: ${value}`)
      }
    },
  },
  HEDRA_SERVER_REQUEST_TIMEOUT: {
    name: 'serverRequestTimeout',
    default: 30000,
    options: 'Integer value from 1 to 300000',
    description: 'Maximum time in milliseconds to wait for incoming HTTP requests to complete',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.number().int().min(1).max(300000).parse(value)
      } catch (_error) {
        throw new ConfigurationError(
          500,
          'configuration error',
          `HEDRA_SERVER_REQUEST_TIMEOUT has invalid value: ${value}`,
        )
      }
    },
  },
}
