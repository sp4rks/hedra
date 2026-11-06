import type { Config } from '#config'
import type { Logger } from '#server/logging/logging.ts'
import { validateConfig } from '#config'
import { PinoLogger } from '#server/logging/pino.ts'

/** Uses a supplied logger or creates the configured implementation. */
export function createLogger(config: Config, logger?: Logger): Logger {
  const values = validateConfig(config)

  if (logger !== undefined && logger !== null) return logger

  switch (values.serverLogLibrary) {
    case 'pino':
      return new PinoLogger(config)
  }
}
