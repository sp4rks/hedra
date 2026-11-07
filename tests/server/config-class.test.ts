import { expect, expectTypeOf, test } from 'bun:test'

import { Config } from '#hedra.ts'

test('Config defaults its logging library to pino', () => {
  const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true' }

  expect(new Config(quiet).serverLogLibrary).toBe('pino')
  expect(new Config({ ...quiet, HEDRA_SERVER_LOG_LIBRARY: '  ' }).serverLogLibrary).toBe('pino')
})

test('Config accepts an explicit pino logging library', () => {
  const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true' }

  expect(new Config({ ...quiet, HEDRA_SERVER_LOG_LIBRARY: 'pino' }).serverLogLibrary).toBe('pino')
  expect(new Config({ ...quiet, HEDRA_SERVER_LOG_LIBRARY: ' pino ' }).serverLogLibrary).toBe('pino')
})

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

test('Config exposes print-routes as a native boolean with a false default', () => {
  const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true' }

  expect(new Config(quiet).serverPrintRoutes).toBe(false)
  expect(new Config({ ...quiet, HEDRA_SERVER_PRINT_ROUTES: 'true' }).serverPrintRoutes).toBe(true)
  expect(new Config({ ...quiet, HEDRA_SERVER_PRINT_ROUTES: ' true ' }).serverPrintRoutes).toBe(true)
  expect(new Config({ ...quiet, HEDRA_SERVER_PRINT_ROUTES: 'false' }).serverPrintRoutes).toBe(false)
})

test('Config preserves precisely typed readonly fields', () => {
  expectTypeOf<Config['serverLogLibrary']>().toEqualTypeOf<'pino'>()
  expectTypeOf<Pick<Config, 'serverLogLibrary'>>().toEqualTypeOf<{ readonly serverLogLibrary: 'pino' }>()
  expectTypeOf<Config['serverListenPort']>().toEqualTypeOf<number>()
  expectTypeOf<Config['serverSilentStartup']>().toEqualTypeOf<boolean>()
  expectTypeOf<Config['serverPrintRoutes']>().toEqualTypeOf<boolean>()
  expectTypeOf<Pick<Config, 'serverListenPort'>>().toEqualTypeOf<{ readonly serverListenPort: number }>()
  expectTypeOf<Pick<Config, 'serverPrintRoutes'>>().toEqualTypeOf<{ readonly serverPrintRoutes: boolean }>()
})
