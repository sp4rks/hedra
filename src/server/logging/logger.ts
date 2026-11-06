import type { Writable } from 'node:stream'
import type { Logger as NativePinoLogger } from 'pino'
import pino from 'pino'

import pretty from 'pino-pretty'

import type { LoggerInterface } from '#server/logging/logging.ts'
import { Config } from '#config'
import { LogFields } from '#server/logging/logging.ts'

/** Creates the default logging adapter. */
export class Logger implements LoggerInterface {
  private readonly logger: NativePinoLogger
  private readonly bindings: LogFields

  /** Uses the configured level and format with initial context and an optional destination. */
  constructor(config: Config = new Config(), destination?: Writable, bindings: LogFields = {}) {
    const initial = LogFields.parse(bindings)
    const options = { level: config.serverLogLevel, base: {} }
    const stream =
      config.serverLogFormat === 'pretty'
        ? pretty({ colorize: true, translateTime: 'SYS:standard', sync: true, destination })
        : destination

    this.bindings = initial
    this.logger = stream ? pino(options, stream) : pino(options)
  }

  /** Combines initial context with the record's validated fields. */
  private fields(fields?: LogFields): LogFields {
    return { ...this.bindings, ...LogFields.parse(fields === undefined ? {} : fields) }
  }

  /** Writes a trace record. */
  trace(message: string, fields?: LogFields): void {
    this.logger.trace(this.fields(fields), message)
  }

  /** Writes a debug record. */
  debug(message: string, fields?: LogFields): void {
    this.logger.debug(this.fields(fields), message)
  }

  /** Writes an informational record. */
  info(message: string, fields?: LogFields): void {
    this.logger.info(this.fields(fields), message)
  }

  /** Writes a warning record. */
  warn(message: string, fields?: LogFields): void {
    this.logger.warn(this.fields(fields), message)
  }

  /** Writes an error record. */
  error(message: string, fields?: LogFields): void {
    this.logger.error(this.fields(fields), message)
  }

  /** Writes a fatal record. */
  fatal(message: string, fields?: LogFields): void {
    this.logger.fatal(this.fields(fields), message)
  }
}
