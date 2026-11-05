import type { Writable } from 'node:stream'
import type { Logger as NativePinoLogger } from 'pino'
import pino from 'pino'
import { z } from 'zod'

import pretty from 'pino-pretty'

import type { Config } from '#config'

const LogFields = z.record(z.string(), z.unknown())

export type LogFields = z.infer<typeof LogFields>

export interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}

class PinoAdapter implements Logger {
  /** Wraps a Pino logger with independently owned context. */
  constructor(
    private readonly logger: NativePinoLogger,
    private readonly bindings: LogFields = {},
  ) {}

  /** Combines inherited context with the record's validated fields. */
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

  /** Returns an independently bound logger sharing the same destination. */
  child(fields: LogFields): Logger {
    return new PinoAdapter(this.logger, { ...this.bindings, ...LogFields.parse(fields) })
  }
}

/** Creates the default logging adapter. */
export class PinoLogger extends PinoAdapter {
  /** Uses the configured level and format with an optional writable destination. */
  constructor(config: Config, destination?: Writable) {
    const options = { level: config.serverLogLevel, base: {} }
    const stream =
      config.serverLogFormat === 'pretty'
        ? pretty({ colorize: true, translateTime: 'SYS:standard', sync: true, destination })
        : destination

    super(stream ? pino(options, stream) : pino(options))
  }
}
