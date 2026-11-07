import type { Writable } from 'node:stream'
import type { Logger as NativePinoLogger } from 'pino'
import pino from 'pino'

import pretty from 'pino-pretty'

import type { LoggerInterface } from '#server/logging/logging.ts'
import { Config } from '#config'
import { HedraError, hedraError, parseInput } from '#errors'
import { LogFields } from '#server/logging/logging.ts'

/** Creates the default logging adapter. */
export class Logger implements LoggerInterface {
  private readonly logger: NativePinoLogger
  private readonly bindings: LogFields

  /** Uses the configured level and format with initial context and an optional destination. */
  constructor(config: Config = new Config(), destination?: Writable, bindings: LogFields = {}) {
    try {
      const initial = parseInput(LogFields, bindings)
      const options = { level: config.serverLogLevel, base: {} }
      const stream =
        config.serverLogFormat === 'pretty'
          ? pretty({ colorize: true, translateTime: 'SYS:standard', sync: true, destination })
          : destination

      this.bindings = initial
      this.logger = stream ? pino(options, stream) : pino(options)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Combines initial context with the record's validated fields. */
  private fields(fields?: LogFields): LogFields {
    return { ...this.bindings, ...parseInput(LogFields, fields === undefined ? {} : fields) }
  }

  /** Writes a trace record. */
  trace(message: string, fields?: LogFields): void {
    try {
      this.logger.trace(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Writes a debug record. */
  debug(message: string, fields?: LogFields): void {
    try {
      this.logger.debug(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Writes an informational record. */
  info(message: string, fields?: LogFields): void {
    try {
      this.logger.info(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Writes a warning record. */
  warn(message: string, fields?: LogFields): void {
    try {
      this.logger.warn(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Writes an error record. */
  error(message: string, fields?: LogFields): void {
    try {
      this.logger.error(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Writes a fatal record. */
  fatal(message: string, fields?: LogFields): void {
    try {
      this.logger.fatal(this.fields(fields), message)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }
}
