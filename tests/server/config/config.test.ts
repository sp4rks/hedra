import { expect, test } from 'bun:test'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConfigurationError } from '#errors'
import { Config } from '#hedra.ts'

test('Config prints each setting with its source', () => {
  const lines: string[] = []
  const original = process.stdout.write

  process.stdout.write = ((message: string | Uint8Array) => {
    lines.push(String(message))

    return true
  }) as typeof process.stdout.write

  try {
    new Config({
      HEDRA_DEPLOYMENT_DOMAIN: 'example.com',
      HEDRA_SERVER_SILENT_STARTUP: 'false',
    })
  } finally {
    process.stdout.write = original
  }

  const table = lines.join('\n')

  expect(table).toContain('Environment Variable')
  expect(table).toContain('Value')
  expect(table).toContain('Source')
  expect(table).toContain('HEDRA_DEPLOYMENT_DOMAIN')
  expect(table).toContain('example.com')
  expect(table).toContain('environ')
  expect(table).toContain('HEDRA_SERVER_ENV')
  expect(table).toContain('dev')
  expect(table).toContain('default')
})

test('Config uses Hedra defaults when variables are unset', () => {
  const config = new Config({})

  expect(config.deploymentDomain).toBe('hedra.local')
  expect(config.deploymentApiDomain).toBe('deployment.hedra.local')
  expect(config.deploymentDocsDomain).toBe('docs.hedra.local')
  expect(config.serverEnv).toBe('dev')
  expect(config.serverSilentStartup).toBe(false)
  expect(config.serverLogFormat).toBe('json')
  expect(config.serverLogLevel).toBe('info')
  expect(config.serverHttpLogEnabled).toBe(true)
  expect(config.serverRequestTimeout).toBe(30000)
  expect(config.serverListenIp).toBe('0.0.0.0')
  expect(config.serverListenPort).toBe(3000)
})

test('Config prefers a trimmed environment value over the default', () => {
  const config = new Config({
    HEDRA_DEPLOYMENT_DOMAIN: '  example.com  ',
    HEDRA_SERVER_ENV: 'prod',
    HEDRA_SERVER_LISTEN_IP: ' ::1 ',
    HEDRA_SERVER_LISTEN_PORT: ' 8080 ',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.deploymentDomain).toBe('example.com')
  expect(config.serverEnv).toBe('prod')
  expect(config.serverListenIp).toBe('::1')
  expect(config.serverListenPort).toBe(8080)
  expect(config.serverSilentStartup).toBe(true)
  expect(config.deploymentApiDomain).toBe('deployment.hedra.local')
})

test('Config treats a blank environment value as unset', () => {
  const config = new Config({
    HEDRA_SERVER_ENV: '   ',
    HEDRA_SERVER_LISTEN_IP: '   ',
    HEDRA_SERVER_LISTEN_PORT: '   ',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.serverEnv).toBe('dev')
  expect(config.serverListenIp).toBe('0.0.0.0')
  expect(config.serverListenPort).toBe(3000)
})

test('SQLite path uses the default when unset or blank', () => {
  expect(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }).sqlitePath).toBe('.runtime/hedra.sqlite')
  expect(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: '   ' }).sqlitePath).toBe(
    '.runtime/hedra.sqlite',
  )
})

test('SQLite path uses a trimmed explicit override', () => {
  expect(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: ' :memory: ' }).sqlitePath).toBe(
    ':memory:',
  )
})

test('Config rejects an invalid deployment domain', () => {
  let error: unknown

  try {
    new Config({
      HEDRA_DEPLOYMENT_DOMAIN: 'not a domain',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(error).toMatchObject({
    detail: 'HEDRA_DEPLOYMENT_DOMAIN has invalid value: not a domain',
  })
})

test('Config rejects a server env outside the allowed set', () => {
  let error: unknown

  try {
    new Config({
      HEDRA_SERVER_ENV: 'staging',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })
  } catch (caught) {
    error = caught
  }

  expect(error).toMatchObject({
    detail: 'HEDRA_SERVER_ENV has invalid value: staging',
  })
})

test('Config rejects a request timeout outside 1 to 300000', () => {
  let error: unknown

  try {
    new Config({
      HEDRA_SERVER_REQUEST_TIMEOUT: '0',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })
  } catch (caught) {
    error = caught
  }

  expect(error).toMatchObject({
    detail: 'HEDRA_SERVER_REQUEST_TIMEOUT has invalid value: 0',
  })
})

test('Config rejects a port outside 1 to 65535', () => {
  let error: unknown

  try {
    new Config({
      HEDRA_SERVER_LISTEN_PORT: '0',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })
  } catch (caught) {
    error = caught
  }

  expect(error).toMatchObject({
    detail: 'HEDRA_SERVER_LISTEN_PORT has invalid value: 0',
  })
})

test('Config rejects an invalid listen IP', () => {
  for (const value of ['localhost', '256.0.0.1']) {
    let error: unknown

    try {
      new Config({
        HEDRA_SERVER_LISTEN_IP: value,
        HEDRA_SERVER_SILENT_STARTUP: 'true',
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ConfigurationError)
    expect(error).toMatchObject({
      detail: `HEDRA_SERVER_LISTEN_IP has invalid value: ${value}`,
    })
  }
})

test('Config reads unset variables from HEDRA_ENV_FILE', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')

  await Bun.write(
    envPath,
    'HEDRA_SERVER_ENV=nonprod\nHEDRA_DEPLOYMENT_DOMAIN=from-file.example\nHEDRA_SQLITE_PATH=from-file.sqlite\n',
  )

  try {
    const config = new Config({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverEnv).toBe('nonprod')
    expect(config.deploymentDomain).toBe('from-file.example')
    expect(config.sqlitePath).toBe('from-file.sqlite')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Config uses defaults when HEDRA_ENV_FILE is missing', async () => {
  const config = new Config({
    HEDRA_ENV_FILE: '/tmp/hedra-config-missing.env',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.serverEnv).toBe('dev')
  expect(config.deploymentDomain).toBe('hedra.local')
})

test('Config keeps an explicit value when HEDRA_ENV_FILE sets the same variable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')

  await Bun.write(envPath, 'HEDRA_SERVER_ENV=prod\nHEDRA_SQLITE_PATH=from-file.sqlite\n')

  try {
    const config = new Config({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_ENV: 'dev',
      HEDRA_SQLITE_PATH: 'explicit.sqlite',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverEnv).toBe('dev')
    expect(config.sqlitePath).toBe('explicit.sqlite')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Config decodes true and false and rejects other boolean values', () => {
  for (const variable of ['HEDRA_SERVER_SILENT_STARTUP', 'HEDRA_SERVER_HTTP_LOGGING']) {
    for (const value of ['not-true', 'yes', '0', 'FALSE']) {
      const env = { HEDRA_SERVER_SILENT_STARTUP: 'true', [variable]: value }

      expect(() => new Config(env)).toThrow(ConfigurationError)
      try {
        new Config(env)
      } catch (error) {
        expect(error).toMatchObject({ detail: `${variable} has invalid value: ${value}` })
      }
    }
  }

  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_HTTP_LOGGING: ' false ' })

  expect(config.serverSilentStartup).toBe(true)
  expect(config.serverHttpLogEnabled).toBe(false)
})

test('Config rejects an invalid log format or level', () => {
  for (const [variable, value] of [
    ['HEDRA_SERVER_LOG_FORMAT', 'pino'],
    ['HEDRA_SERVER_LOG_LEVEL', 'verbose'],
  ] as const) {
    try {
      new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', [variable]: value })
      throw new Error('Expected configuration to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError)
      expect(error).toMatchObject({ detail: `${variable} has invalid value: ${value}` })
    }
  }
})

test('Config does not mutate its supplied environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')

  await Bun.write(envPath, 'HEDRA_SERVER_ENV=prod\n')
  const env = Object.freeze({ HEDRA_ENV_FILE: envPath, HEDRA_SERVER_SILENT_STARTUP: 'true' })

  try {
    const config = new Config(env)

    expect(config.serverEnv).toBe('prod')
    expect(env).toEqual({ HEDRA_ENV_FILE: envPath, HEDRA_SERVER_SILENT_STARTUP: 'true' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Config uses the default when an explicit blank shadows an env file value', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')

  await Bun.write(envPath, 'HEDRA_SERVER_LISTEN_PORT=8080\n')

  try {
    const config = new Config({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_LISTEN_PORT: '  ',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverListenPort).toBe(3000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Config propagates env-file read failures', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))

  try {
    expect(() => new Config({ HEDRA_ENV_FILE: dir, HEDRA_SERVER_SILENT_STARTUP: 'true' })).toThrow()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// Root and Windows do not reliably enforce these directory permissions.
test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'Config propagates access errors for an env file inside an inaccessible directory',
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
    const envPath = join(dir, 'app.env')

    try {
      await Bun.write(envPath, 'HEDRA_SERVER_LISTEN_PORT=8080\n')
      await chmod(dir, 0)
      let failure: unknown

      try {
        new Config({ HEDRA_ENV_FILE: envPath, HEDRA_SERVER_SILENT_STARTUP: 'true' })
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(dir, 0o700)
      await rm(dir, { recursive: true, force: true })
    }
  },
)

test('Config prints no success report when a setting is invalid', () => {
  const output: string[] = []
  const original = process.stdout.write

  process.stdout.write = ((message: string | Uint8Array) => {
    output.push(String(message))

    return true
  }) as typeof process.stdout.write

  try {
    expect(() => new Config({ HEDRA_DEPLOYMENT_DOMAIN: 'bad domain' })).toThrow(ConfigurationError)
  } finally {
    process.stdout.write = original
  }
  expect(output.join('')).toBe('')
})

test('Hedra preserves ambient process.env identity for .env fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const packageEntry = join(import.meta.dir, '../../../src/hedra.ts')
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HEDRA_')))
  const script = `import { Hedra } from ${JSON.stringify(packageEntry)}; process.stdout.write(String(new Hedra({ env: process.env }).port))`

  await Bun.write(join(dir, '.env'), 'HEDRA_SERVER_LISTEN_PORT=8123\n')

  try {
    const result = Bun.spawnSync(['bun', '--no-env-file', '-e', script], {
      cwd: dir,
      env: {
        ...ambient,
        HEDRA_ENV_FILE: join(dir, 'missing.env'),
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LOG_LEVEL: 'silent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe('8123')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
