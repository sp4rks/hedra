import { z } from 'zod'

import type { ConfigDefinitions } from '#config'

export const serverVariables = {
  HEDRA_SQLITE_PATH: {
    name: 'sqlitePath',
    default: '.runtime/hedra.sqlite',
    options: 'SQLite database path or :memory:',
    description: 'The shared collection database location',
    schema: z.string().min(1),
  },
  HEDRA_SERVER_ENV: {
    name: 'serverEnv',
    default: 'dev',
    options: ['test', 'dev', 'nonprod', 'prod'],
    description: 'The environment the server is running in',
    schema: z.enum(['test', 'dev', 'nonprod', 'prod']),
  },
  HEDRA_SERVER_SILENT_STARTUP: {
    name: 'serverSilentStartup',
    default: false,
    options: ['true', 'false'],
    description: 'Whether to suppress the startup message',
    schema: z.boolean(),
  },
  HEDRA_SERVER_LOG_FORMAT: {
    name: 'serverLogFormat',
    default: 'json',
    options: ['json', 'pretty'],
    description: 'The format used for server logging',
    schema: z.enum(['json', 'pretty']),
  },
  HEDRA_SERVER_LOG_LEVEL: {
    name: 'serverLogLevel',
    default: 'info',
    options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'],
    description: 'The minimum log level to output',
    schema: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']),
  },
  HEDRA_SERVER_HTTP_LOGGING: {
    name: 'serverHttpLogEnabled',
    default: true,
    options: ['true', 'false'],
    description: 'Enable or disable HTTP request/response logging',
    schema: z.boolean(),
  },
  HEDRA_SERVER_LISTEN_IP: {
    name: 'serverListenIp',
    default: '0.0.0.0',
    options: 'IPv4 or IPv6 address',
    description: 'The IP address the server listens on',
    schema: z.union([z.ipv4(), z.ipv6()]),
  },
  HEDRA_SERVER_LISTEN_PORT: {
    name: 'serverListenPort',
    default: 3000,
    options: 'Integer value from 1 to 65535',
    description: 'The port the server listens on',
    schema: z.number().int().min(1).max(65535),
  },
  HEDRA_SERVER_REQUEST_TIMEOUT: {
    name: 'serverRequestTimeout',
    default: 30000,
    options: 'Integer value from 1 to 300000',
    description: 'Maximum time in milliseconds to wait for incoming HTTP requests to complete',
    schema: z.number().int().min(1).max(300000),
  },
} satisfies ConfigDefinitions
