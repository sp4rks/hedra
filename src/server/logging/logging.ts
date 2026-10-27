import type { DestinationStream, Logger } from 'pino'
import pino from 'pino'

import pretty from 'pino-pretty'

/**
 * Creates the application logger from the loaded server configuration.
 * `pino` writes JSON. `pino-pretty` and `dev` write a readable line.
 * Logs go to `destination` when one is given, and to standard output otherwise.
 */
export function loadAppLogger(config: Record<string, string>, destination?: DestinationStream): Logger {
  const options = {
    level: config.serverLogLevel ?? 'info',
    base: {
      instanceId: config.instanceId,
    },
  }
  const logType = config.serverLogType ?? 'pino'

  if (logType === 'pino-pretty' || logType === 'dev') {
    return pino(
      options,
      pretty({
        colorize: true,
        translateTime: 'SYS:standard',
        sync: true,
        destination,
      }),
    )
  }

  return destination ? pino(options, destination) : pino(options)
}
