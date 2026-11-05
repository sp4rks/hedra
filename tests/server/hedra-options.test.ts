import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { z } from 'zod'

import type { LogFields, Logger } from '#hedra.ts'
import { ConfigurationError } from '#errors'
import { Collection, Config, Hedra, PinoLogger } from '#hedra.ts'

class RecordingLogger implements Logger {
  /** Shares captured records while keeping this logger's bindings separate. */
  constructor(
    readonly records: { message: string; fields: LogFields }[],
    readonly bindings: LogFields = {},
  ) {}

  /** Records inherited bindings and per-call fields without filtering. */
  private record(message: string, fields: LogFields = {}): void {
    this.records.push({ message, fields: { ...this.bindings, ...fields } })
  }

  /** Records trace messages without filtering. */
  trace(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Records debug messages without filtering. */
  debug(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Records informational messages without filtering. */
  info(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Records warning messages without filtering. */
  warn(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Records error messages without filtering. */
  error(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Records fatal messages without filtering. */
  fatal(message: string, fields?: LogFields): void {
    this.record(message, fields)
  }

  /** Shares records with a separately bound child. */
  child(fields: LogFields): Logger {
    return new RecordingLogger(this.records, { ...this.bindings, ...fields })
  }
}

test('Hedra accepts a Config and binds its identity to the supplied logger', () => {
  let output = ''
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += String(chunk)
      callback()
    },
  })
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new PinoLogger(config, destination)
  const app = new Hedra({ config, logger })

  app.log.info('Ready')

  expect(app.config).toBe(config)
  expect(JSON.parse(output)).toMatchObject({ msg: 'Ready', instanceId: app.instanceId })
})

test('Hedra isolates app identities while sharing a custom backend and Config', () => {
  const records: { message: string; fields: LogFields }[] = []
  const parent = new RecordingLogger(records, { service: 'test' })
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const first = new Hedra({ config, logger: parent })
  const second = new Hedra({ config, logger: parent })

  first.log.info('first')
  second.log.info('second')
  parent.info('parent')

  expect(first.instanceId).not.toBe(second.instanceId)
  expect(first.config).toBe(config)
  expect(second.config).toBe(config)
  expect(records[0]).toEqual({ message: 'first', fields: { service: 'test', instanceId: first.instanceId } })
  expect(records[1]).toEqual({ message: 'second', fields: { service: 'test', instanceId: second.instanceId } })
  expect(records[2]).toEqual({ message: 'parent', fields: { service: 'test' } })
})

test('Hedra logs collection registration only when enabled and allowed by the log level', () => {
  for (const [setting, level, expected] of [
    [undefined, 'info', false],
    ['false', 'info', false],
    ['true', 'info', true],
    ['true', 'warn', false],
  ] as const) {
    let output = ''
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk)
        callback()
      },
    })
    const config = new Config({
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SQLITE_PATH: ':memory:',
      HEDRA_SERVER_PRINT_ROUTES: setting,
      HEDRA_SERVER_LOG_LEVEL: level,
    })
    const app = new Hedra({ config, logger: new PinoLogger(config, destination) })

    try {
      app.register(new Collection('cars', z.object({ make: z.string() })))

      expect(output.includes('Registering collection: cars')).toBe(expected)
      if (expected)
        expect(JSON.parse(output)).toMatchObject({ msg: 'Registering collection: cars', instanceId: app.instanceId })
    } finally {
      app.close()
    }
  }
})

test('Hedra rejects conflicting, unknown or malformed options', () => {
  const env = { HEDRA_SERVER_SILENT_STARTUP: 'true' }
  const config = new Config(env)

  expect(() => new Hedra({ env, config })).toThrow('Provide either env or config')
  expect(() => new Hedra({ env, unknown: true } as never)).toThrow()
  expect(() => new Hedra({ env: { HEDRA_SERVER_LISTEN_PORT: 3000 } as never })).toThrow()
  expect(() => new Hedra({ env, logger: { info() {} } as never })).toThrow()
  expect(() => new Hedra(env as never)).toThrow()
})

test('Hedra accepts a callable logger implementing the Logger interface', () => {
  const records: { message: string; fields: LogFields }[] = []
  const recording = new RecordingLogger(records)
  const logger: Logger = Object.assign(() => {}, {
    trace: recording.trace.bind(recording),
    debug: recording.debug.bind(recording),
    info: recording.info.bind(recording),
    warn: recording.warn.bind(recording),
    error: recording.error.bind(recording),
    fatal: recording.fatal.bind(recording),
    child: recording.child.bind(recording),
  })
  const app = new Hedra({ env: { HEDRA_SERVER_SILENT_STARTUP: 'true' }, logger })

  app.log.info('Ready')

  expect(records).toEqual([{ message: 'Ready', fields: { instanceId: app.instanceId } }])
})

test('Hedra rejects invalid Config subclass values before touching the logger or opening SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-invalid-config-'))
  const path = join(dir, 'db.sqlite')

  class InvalidConfig extends Config {
    override readonly serverListenPort = 0
  }

  const config = new InvalidConfig({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: path })
  const parent: Logger = {
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      throw new Error('The logger should not be touched')
    },
  }

  try {
    expect(() => new Hedra({ config, logger: parent })).toThrow(ConfigurationError)
    expect(existsSync(path)).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Hedra rejects a Config subclass with a missing required setting', () => {
  class MissingConfig extends Config {
    /** Represents an incomplete subclass at the public boundary. */
    constructor() {
      super({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
      Reflect.deleteProperty(this, 'serverListenPort')
    }
  }

  expect(() => new Hedra({ config: new MissingConfig() })).toThrow(ConfigurationError)
})

test('Hedra rejects a malformed child returned by a custom logger', () => {
  const records: { message: string; fields: LogFields }[] = []
  const parent = new RecordingLogger(records)

  parent.child = () => ({ info() {} }) as never
  expect(() => new Hedra({ env: { HEDRA_SERVER_SILENT_STARTUP: 'true' }, logger: parent })).toThrow('Expected a logger')
})
