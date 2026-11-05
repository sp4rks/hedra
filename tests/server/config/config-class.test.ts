import { expect, expectTypeOf, test } from 'bun:test'

import { Config } from '#hedra.ts'

test('Config exposes native configuration values as direct properties', () => {
  const config = new Config({
    HEDRA_SERVER_LISTEN_PORT: '8080',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SERVER_HTTP_LOGGING: 'false',
  })

  expect(config.serverListenPort).toBe(8080)
  expect(config.serverSilentStartup).toBe(true)
  expect(config.serverHttpLogEnabled).toBe(false)
})

test('Config preserves precisely typed readonly fields', () => {
  expectTypeOf<Config['serverListenPort']>().toEqualTypeOf<number>()
  expectTypeOf<Config['serverSilentStartup']>().toEqualTypeOf<boolean>()
  expectTypeOf<Pick<Config, 'serverListenPort'>>().toEqualTypeOf<{ readonly serverListenPort: number }>()
})
