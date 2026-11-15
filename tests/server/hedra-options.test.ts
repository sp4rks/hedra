import { expect, expectTypeOf, test } from 'bun:test'

import type { HedraOptions, Logger, LoggerInterface } from '#hedra.ts'
import { Config, Hedra, Resource } from '#hedra.ts'

test('HedraOptions has no environment option', () => {
  expectTypeOf<'env' extends keyof HedraOptions ? true : false>().toEqualTypeOf<false>()
})

test('Logger implements LoggerInterface and HedraOptions accepts the interface', () => {
  expectTypeOf<Logger>().toExtend<LoggerInterface>()
  expectTypeOf<NonNullable<HedraOptions['logger']>>().toEqualTypeOf<LoggerInterface>()
  expectTypeOf<'child' extends keyof LoggerInterface ? true : false>().toEqualTypeOf<false>()
  expectTypeOf<'child' extends keyof Logger ? true : false>().toEqualTypeOf<false>()
})

test('Hedra retains supplied configuration when a wider options object includes unknown properties', () => {
  class CustomConfig extends Config {
    readonly serviceName = 'example'

    /** Loads built-in settings and adds application-specific configuration. */
    constructor() {
      super({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LISTEN_PORT: '8080' })
    }
  }

  const config = new CustomConfig()
  const options = { config, env: { HEDRA_SERVER_LISTEN_PORT: '9000' }, name: 'app' }
  const app = new Hedra(options)

  expect(app.config).toBe(config)
  expect(config.serviceName).toBe('example')
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

test('Hedra retains a custom LoggerInterface and uses it for collection registration', () => {
  const records: string[] = []
  let closed = false
  const logger = Object.freeze({
    trace: () => {},
    debug: () => {},
    info: (message: string) => records.push(message),
    warn: () => {},
    error: () => {},
    fatal: () => {},
    close: () => {
      closed = true
    },
  }) satisfies LoggerInterface
  const config = new Config({
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SERVER_PRINT_ROUTES: 'true',
    HEDRA_SQLITE_PATH: ':memory:',
  })
  const app = new Hedra({ config, logger })

  expect(app.log).toBe(logger)
  app.register(Resource.meta({ name: 'widgets' }))
  expect(records).toEqual(['Registering collection: widgets'])
  app.close()
  expect(closed).toBe(false)
})
