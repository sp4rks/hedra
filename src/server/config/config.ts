import { readFileSync } from 'node:fs'
import { parseEnv, styleText } from 'node:util'
import { z } from 'zod'

import { deploymentVariables } from '#config/categories/deployment.ts'
import { serverVariables } from '#config/categories/server.ts'
import { ConfigurationError } from '#errors'

const ConfigEntry = z.object({
  name: z.string(),
  default: z.union([z.string(), z.number(), z.boolean()]),
  options: z.union([z.string(), z.array(z.string()), z.number(), z.array(z.number())]),
  description: z.string(),
  schema: z.instanceof(z.ZodType),
})
const ConfigDefinitions = z.record(z.string(), ConfigEntry)

export type ConfigDefinitions = z.infer<typeof ConfigDefinitions>

export const Environment = z.record(z.string(), z.string().optional())

export const ConfigValues = z.object({
  deploymentDomain: deploymentVariables.HEDRA_DEPLOYMENT_DOMAIN.schema,
  deploymentApiDomain: deploymentVariables.HEDRA_DEPLOYMENT_API_DOMAIN.schema,
  deploymentDocsDomain: deploymentVariables.HEDRA_DEPLOYMENT_DOCS_DOMAIN.schema,
  sqlitePath: serverVariables.HEDRA_SQLITE_PATH.schema,
  serverEnv: serverVariables.HEDRA_SERVER_ENV.schema,
  serverSilentStartup: serverVariables.HEDRA_SERVER_SILENT_STARTUP.schema,
  serverLogFormat: serverVariables.HEDRA_SERVER_LOG_FORMAT.schema,
  serverLogLevel: serverVariables.HEDRA_SERVER_LOG_LEVEL.schema,
  serverHttpLogEnabled: serverVariables.HEDRA_SERVER_HTTP_LOGGING.schema,
  serverListenIp: serverVariables.HEDRA_SERVER_LISTEN_IP.schema,
  serverListenPort: serverVariables.HEDRA_SERVER_LISTEN_PORT.schema,
  serverRequestTimeout: serverVariables.HEDRA_SERVER_REQUEST_TIMEOUT.schema,
})

export type ConfigValues = z.infer<typeof ConfigValues>

const defaults: ConfigDefinitions = {
  ...deploymentVariables,
  ...serverVariables,
}
const columnWidth = 50

/** Prints the startup configuration table heading. */
function printConfigHeader(): void {
  process.stdout.write(
    `\n${styleText('white', 'Environment Variable'.padEnd(columnWidth))} ${styleText('white', 'Value'.padEnd(columnWidth))} ${styleText('white', 'Source')}\n`,
  )
}

/** Prints one setting and whether it came from the environment or the built-in default. */
function printConfigRow(variable: string, value: string, source: 'environ' | 'default'): void {
  const sourceLabel = source === 'environ' ? styleText('blueBright', 'environ') : styleText('greenBright', 'default')

  process.stdout.write(
    `${styleText('magenta', variable.padEnd(columnWidth))} ${value.padEnd(columnWidth)} ${sourceLabel}\n`,
  )
}

/** Reads an env file and fills keys the caller has not already set. */
function overlayEnvFile(env: typeof Bun.env, path: string): boolean {
  let content: string

  try {
    content = readFileSync(path, 'utf8')
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false

    throw error
  }

  const parsed = parseEnv(content)

  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value
  }

  return true
}

/** Validates native configuration values and reports the associated environment variable. */
export function validateConfig(input: unknown, displayValues?: Record<string, string>): ConfigValues {
  const result = ConfigValues.safeParse(input)

  if (!result.success) {
    const field = result.error.issues[0]?.path[0]
    const definition = Object.entries(defaults).find(([, entry]) => entry.name === field)

    if (definition) {
      const [variable, entry] = definition
      const value = input !== null && typeof input === 'object' ? Reflect.get(input, entry.name) : undefined

      throw new ConfigurationError(
        500,
        'configuration error',
        `${variable} has invalid value: ${displayValues?.[entry.name] ?? String(value)}`,
      )
    }

    throw new ConfigurationError(500, 'configuration error', 'Invalid configuration')
  }

  return result.data
}

/** Loads and validates Hedra's deployment and server configuration. */
export class Config {
  declare readonly deploymentDomain: ConfigValues['deploymentDomain']
  declare readonly deploymentApiDomain: ConfigValues['deploymentApiDomain']
  declare readonly deploymentDocsDomain: ConfigValues['deploymentDocsDomain']
  declare readonly sqlitePath: ConfigValues['sqlitePath']
  declare readonly serverEnv: ConfigValues['serverEnv']
  declare readonly serverSilentStartup: ConfigValues['serverSilentStartup']
  declare readonly serverLogFormat: ConfigValues['serverLogFormat']
  declare readonly serverLogLevel: ConfigValues['serverLogLevel']
  declare readonly serverHttpLogEnabled: ConfigValues['serverHttpLogEnabled']
  declare readonly serverListenIp: ConfigValues['serverListenIp']
  declare readonly serverListenPort: ConfigValues['serverListenPort']
  declare readonly serverRequestTimeout: ConfigValues['serverRequestTimeout']

  /** Resolves explicit settings, an env file and defaults, in that order. */
  constructor(env: typeof Bun.env = process.env) {
    const resolved = Environment.parse(env)
    const envFile = resolved.HEDRA_ENV_FILE?.trim()

    if (envFile) {
      const loaded = overlayEnvFile(resolved, envFile)

      if (!loaded && env === process.env) overlayEnvFile(resolved, '.env')
    } else if (env === process.env) {
      overlayEnvFile(resolved, '.env')
    }

    const input: Record<string, string | number | boolean> = {}
    const displayValues: Record<string, string> = {}
    const sources: Record<string, 'environ' | 'default'> = {}

    for (const [variable, entry] of Object.entries(defaults)) {
      const environmentValue = resolved[variable]?.trim()
      const fromEnvironment = environmentValue !== undefined && environmentValue !== ''
      const raw = fromEnvironment ? environmentValue : entry.default
      let value: string | number | boolean = raw

      if (fromEnvironment && typeof entry.default === 'number') value = Number(raw)
      if (fromEnvironment && typeof entry.default === 'boolean') {
        if (raw === 'true') value = true
        else if (raw === 'false') value = false
      }

      input[entry.name] = value
      displayValues[entry.name] = String(raw)
      sources[entry.name] = fromEnvironment ? 'environ' : 'default'
    }

    const values = validateConfig(input, displayValues)

    Object.assign(this, values)

    if (!values.serverSilentStartup) {
      printConfigHeader()

      for (const [variable, entry] of Object.entries(defaults)) {
        printConfigRow(variable, String(Reflect.get(values, entry.name)), sources[entry.name] ?? 'default')
      }

      process.stdout.write('\nSee src/server/config/categories/ for defaults and descriptions.\n\n')
    }
  }
}
