import { expect, expectTypeOf, test } from 'bun:test'

import type { HedraOptions, Logger, PinoLogger } from '#hedra.ts'
import { ConfigurationError } from '#errors'
import { Config, Hedra } from '#hedra.ts'

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
    readonly serviceName = 'example'

    /** Loads built-in settings and adds application-specific configuration. */
    constructor() {
      super({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LISTEN_PORT: '8080' })
    }
  }

  const config = new CustomConfig()
  const options = { config, env: { HEDRA_SERVER_LISTEN_PORT: '9000' }, logger: 'ignored', name: 'app' }
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

test('Config validates supplied environment values', () => {
  expect(() => new Config({ HEDRA_SERVER_LISTEN_PORT: 3000 } as never)).toThrow()
  expect(() => new Config({ HEDRA_SERVER_LISTEN_PORT: '0' })).toThrow(ConfigurationError)
})
