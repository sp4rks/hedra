import { existsSync, readFileSync } from 'node:fs'
import { parseEnv, styleText } from 'node:util'
import pino from 'pino'

import { deploymentVariables } from '#config/categories/deployment.ts'
import { serverVariables } from '#config/categories/server.ts'

const logger = pino()

export type ConfigEntry = {
  name: string
  default: string | number | boolean
  options: string | string[] | number | number[]
  description: string
  validate: (value: string | number | boolean) => void
}

export type Config = Record<string, ConfigEntry>

const defaults: Config = {
  ...deploymentVariables,
  ...serverVariables,
}

const columnWidth = 50

/** Prints the startup configuration table heading. */
function printConfigHeader(): void {
  console.log(
    `\n${styleText('white', 'Environment Variable'.padEnd(columnWidth))} ${styleText('white', 'Value'.padEnd(columnWidth))} ${styleText('white', 'Source')}`,
  )
}

/** Prints one setting and whether its value came from the environment or the built-in default. */
function printConfigRow(variable: string, value: string, source: 'environ' | 'default'): void {
  const sourceLabel = source === 'environ' ? styleText('blueBright', 'environ') : styleText('greenBright', 'default')

  console.log(`${styleText('magenta', variable.padEnd(columnWidth))} ${value.padEnd(columnWidth)} ${sourceLabel}`)
}

/** Prints where a reader can find the built-in defaults and their descriptions. */
function printConfigFooter(): void {
  console.log('\nSee src/server/config/categories/ for defaults and descriptions.\n')
}

/** Reads an env file and fills keys the caller has not already set. */
function overlayEnvFile(env: typeof Bun.env, path: string): boolean {
  if (!existsSync(path)) return false

  const parsed = parseEnv(readFileSync(path, 'utf8'))

  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value
  }

  return true
}

/**
 * Loads deployment and server settings.
 * An explicit value wins over `HEDRA_ENV_FILE`, which wins over the built-in default.
 * The result is keyed by each setting's config name and includes a new `instanceId`.
 */
export function loadServerConfig(env: typeof Bun.env = process.env): Record<string, string> {
  const resolved: typeof Bun.env = { ...env }
  const envFile = resolved.HEDRA_ENV_FILE?.trim()

  if (envFile) {
    const loaded = overlayEnvFile(resolved, envFile)

    if (!loaded && env === process.env) overlayEnvFile(resolved, '.env')
  } else if (env === process.env) {
    overlayEnvFile(resolved, '.env')
  }

  const serverConfig: Record<string, string> = {
    instanceId: crypto.randomUUID(),
  }
  const silentStartup = resolved.HEDRA_SERVER_SILENT_STARTUP === 'true'

  // A person reads this table in the terminal during startup.
  if (!silentStartup) printConfigHeader()

  for (const configKey of Object.keys(defaults)) {
    const defaultConfig = defaults[configKey]

    if (!defaultConfig) continue

    const environmentValue = resolved[configKey]?.trim()
    const fromEnvironment = environmentValue !== undefined && environmentValue !== ''
    const finalValue = fromEnvironment ? environmentValue : defaultConfig.default

    try {
      defaultConfig.validate(String(finalValue))
    } catch (error) {
      logger.error({ err: error }, 'configuration error')
      throw error
    }

    serverConfig[defaultConfig.name] = String(finalValue)

    if (!silentStartup) {
      printConfigRow(configKey, String(finalValue), fromEnvironment ? 'environ' : 'default')
    }
  }

  if (!silentStartup) printConfigFooter()

  return serverConfig
}
