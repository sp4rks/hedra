import { expect, expectTypeOf, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { HedraOptions, Logger, PinoLogger } from '#hedra.ts'
import { ConfigurationError } from '#errors'
import { Config, createLogger, Hedra } from '#hedra.ts'

test('HedraOptions has no environment option', () => {
  expectTypeOf<'env' extends keyof HedraOptions ? true : false>().toEqualTypeOf<false>()
})

test('Logger has no child method and HedraOptions has no logger option', () => {
  expectTypeOf<'child' extends keyof Logger ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<'child' extends keyof PinoLogger ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<'logger' extends keyof HedraOptions ? true : false>().toEqualTypeOf<false>()
})

test('Hedra retains supplied configuration when a wider options object includes unknown properties', () => {
  class CustomConfig extends Config {
    override readonly serverListenPort = 8080
  }

  const config = new CustomConfig({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const options = { config, env: { HEDRA_SERVER_LISTEN_PORT: '9000' }, logger: 'ignored', name: 'app' }
  const app = new Hedra(options)

  expect(app.config).toBe(config)
  expect(app.port).toBe(8080)
  expect(typeof app.log.info).toBe('function')
})

test('Hedra creates independent loggers and identities for apps sharing a Config', () => {
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const first = new Hedra({ config })
  const second = new Hedra({ config })

  expect(first.config).toBe(config)
  expect(second.config).toBe(config)
  expect(first.instanceId).not.toBe(second.instanceId)
  expect(first.log).not.toBe(second.log)
})

test('createLogger and Hedra reject invalid library configuration from a subclass', () => {
  class InvalidLibraryConfig extends Config {
    override readonly serverLogLibrary = 'pretty' as never
  }

  const config = new InvalidLibraryConfig({ HEDRA_SERVER_SILENT_STARTUP: 'true' })

  expect(() => createLogger(config)).toThrow(ConfigurationError)
  expect(() => new Hedra({ config })).toThrow(ConfigurationError)
})

test('Config validates supplied environment values', () => {
  expect(() => new Config({ HEDRA_SERVER_LISTEN_PORT: 3000 } as never)).toThrow()
  expect(() => new Config({ HEDRA_SERVER_LISTEN_PORT: '0' })).toThrow(ConfigurationError)
})

test('Hedra rejects invalid Config subclass values before opening SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-invalid-config-'))
  const path = join(dir, 'db.sqlite')

  class InvalidConfig extends Config {
    override readonly serverListenPort = 0
  }

  const config = new InvalidConfig({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: path })

  try {
    expect(() => new Hedra({ config })).toThrow(ConfigurationError)
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
