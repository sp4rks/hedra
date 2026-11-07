import type { Writable } from 'node:stream'
import type { Logger as NativePinoLogger } from 'pino'
import pino from 'pino'
import { z } from 'zod'

import pretty from 'pino-pretty'

import { Config } from '#config'
import { HedraError, hedraError, parseInput } from '#errors'

export const LogFields = z.record(z.string(), z.unknown())

export type LogFields = z.infer<typeof LogFields>

export interface LoggerInterface {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
}

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
