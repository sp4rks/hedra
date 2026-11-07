import { styleText } from 'node:util'
import { z } from 'zod'

import { deploymentVariables } from '#config/deployment.ts'
import { serverVariables } from '#config/server.ts'
import { ConfigurationError, hedraError } from '#errors'

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

const defaults = {
  ...deploymentVariables,
  ...serverVariables,
}

type ConfigShape = {
  [Entry in (typeof defaults)[keyof typeof defaults] as Entry['name']]: Entry['schema']
}

export const ConfigValues = z.object(
  Object.fromEntries(Object.values(defaults).map((entry) => [entry.name, entry.schema])) as ConfigShape,
)

export type ConfigValues = z.infer<typeof ConfigValues>

const columnWidth = 50

export type Config = Readonly<ConfigValues>

/** Loads and validates Hedra's deployment and server configuration. */
export const Config = class Config {
  /** Resolves environment settings and defaults. */
  constructor(env: typeof Bun.env = process.env) {
    try {
      const resolved = Environment.parse(env)

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

      const values = Config.validateConfig(input, displayValues)

      Object.assign(this, values)

      if (!values.serverSilentStartup) {
        Config.printConfigHeader()

        for (const [variable, entry] of Object.entries(defaults)) {
          Config.printConfigRow(variable, String(Reflect.get(values, entry.name)), sources[entry.name] ?? 'default')
        }

        process.stdout.write('\nSee src/server/configs/ for defaults and descriptions.\n\n')
      }
    } catch (error) {
      throw hedraError(error, ConfigurationError)
    }
  }

  /** Prints the startup configuration table heading. */
  private static printConfigHeader(): void {
    process.stdout.write(
      `\n${styleText('white', 'Environment Variable'.padEnd(columnWidth))} ${styleText('white', 'Value'.padEnd(columnWidth))} ${styleText('white', 'Source')}\n`,
    )
  }

  /** Prints one setting and whether it came from the environment or the built-in default. */
  private static printConfigRow(variable: string, value: string, source: 'environ' | 'default'): void {
    const sourceLabel = source === 'environ' ? styleText('blueBright', 'environ') : styleText('greenBright', 'default')

    process.stdout.write(
      `${styleText('magenta', variable.padEnd(columnWidth))} ${value.padEnd(columnWidth)} ${sourceLabel}\n`,
    )
  }

  /** Validates native configuration values and reports the associated environment variable. */
  private static validateConfig(input: unknown, displayValues?: Record<string, string>): ConfigValues {
    const result = ConfigValues.safeParse(input)

    if (!result.success) {
      const field = result.error.issues[0]?.path[0]
      const definition = Object.entries(defaults).find(([, entry]) => entry.name === field)

      if (definition) {
        const [variable, entry] = definition
        const value = input !== null && typeof input === 'object' ? Reflect.get(input, entry.name) : undefined

        throw new ConfigurationError(
          'configuration error',
          `${variable} has invalid value: ${displayValues?.[entry.name] ?? String(value)}`,
        )
      }

      throw new ConfigurationError('configuration error', 'Invalid configuration')
    }

    return result.data
  }
} as unknown as new (
  env?: typeof Bun.env,
) => Config // The constructor assigns the complete Zod-parsed values.
