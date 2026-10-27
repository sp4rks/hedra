import { parseEnv } from 'node:util'

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

/** Reads an env file and fills keys the caller has not already set. */
async function overlayEnvFile(env: NodeJS.ProcessEnv, path: string): Promise<boolean> {
  const file = Bun.file(path)
  if (!(await file.exists())) return false

  const parsed = parseEnv(await file.text())
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
export async function loadServerConfig(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const resolved: NodeJS.ProcessEnv = { ...env }
  const envFile = resolved.HEDRA_ENV_FILE?.trim()

  if (envFile) {
    const loaded = await overlayEnvFile(resolved, envFile)
    if (!loaded && env === process.env) await overlayEnvFile(resolved, '.env')
  } else if (env === process.env) {
    await overlayEnvFile(resolved, '.env')
  }

  const serverConfig: Record<string, string> = {
    instanceId: crypto.randomUUID(),
  }
  const silentStartup = resolved.HEDRA_SERVER_SILENT_STARTUP === 'true'

  if (!silentStartup) logger.info('configuration')

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
      logger.info(
        { variable: configKey, value: String(finalValue), source: fromEnvironment ? 'environ' : 'default' },
        'configuration value',
      )
    }
  }

  return serverConfig
}
