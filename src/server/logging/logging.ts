import { z } from 'zod'

export const LogFields = z.record(z.string(), z.unknown())

export type LogFields = z.infer<typeof LogFields>

export interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
}
