import { expectTypeOf, test } from 'bun:test'

import type { Config } from '#hedra.ts'

test('Config preserves precisely typed readonly fields', () => {
  expectTypeOf<InstanceType<typeof Config>>().toEqualTypeOf<Config>()
  expectTypeOf<Config['serverEnv']>().toEqualTypeOf<'test' | 'dev' | 'nonprod' | 'prod'>()
  expectTypeOf<Config['serverLogLibrary']>().toEqualTypeOf<'pino'>()
  expectTypeOf<Config['serverLogFormat']>().toEqualTypeOf<'json' | 'pretty'>()
  expectTypeOf<Config['serverLogLevel']>().toEqualTypeOf<
    'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'
  >()
  expectTypeOf<Pick<Config, 'serverLogLibrary'>>().toEqualTypeOf<{ readonly serverLogLibrary: 'pino' }>()
  expectTypeOf<Config['serverListenPort']>().toEqualTypeOf<number>()
  expectTypeOf<Config['serverSilentStartup']>().toEqualTypeOf<boolean>()
  expectTypeOf<Config['serverPrintRoutes']>().toEqualTypeOf<boolean>()
  expectTypeOf<Pick<Config, 'serverListenPort'>>().toEqualTypeOf<{ readonly serverListenPort: number }>()
  expectTypeOf<Pick<Config, 'serverPrintRoutes'>>().toEqualTypeOf<{ readonly serverPrintRoutes: boolean }>()
  expectTypeOf<string extends keyof Config ? true : false>().toEqualTypeOf<false>()
})
