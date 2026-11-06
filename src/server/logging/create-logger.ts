import type { Config } from '#config'
import type { LogFields, Logger } from '#server/logging/logging.ts'
import { validateConfig } from '#config'
import { PinoLogger } from '#server/logging/pino.ts'

/** Creates the configured implementation with initial context. */
export function createLogger(config: Config, bindings?: LogFields): Logger {
  const values = validateConfig(config)

  switch (values.serverLogLibrary) {
    case 'pino':
      return new PinoLogger(config, undefined, bindings)
  }
}
