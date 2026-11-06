import type { Config } from '#config'
import type { LogFields, Logger } from '#server/logging/logging.ts'
import { PinoLogger } from '#server/logging/pino.ts'

/** Creates the configured implementation with initial context. */
export function createLogger(config: Config, bindings?: LogFields): Logger {
  switch (config.serverLogLibrary) {
    case 'pino':
      return new PinoLogger(config, undefined, bindings)
  }
}
