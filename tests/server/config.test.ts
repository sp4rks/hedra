import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
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
  expect(table).toContain('HEDRA_SERVER_LOG_LIBRARY')
  expect(table).toContain('pino')
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
  expect(config.serverLogLibrary).toBe('pino')
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
    status: 500,
    title: 'configuration error',
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

test('Config reports the original value for a non-numeric port', () => {
  let error: unknown

  try {
    new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LISTEN_PORT: 'not-a-number' })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(error).toMatchObject({ detail: 'HEDRA_SERVER_LISTEN_PORT has invalid value: not-a-number' })
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

test('Config ignores legacy file selection in an explicit environment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')

  await Bun.write(
    envPath,
    'HEDRA_SERVER_ENV=nonprod\nHEDRA_DEPLOYMENT_DOMAIN=from-file.example\nHEDRA_SQLITE_PATH=from-file.sqlite\n',
  )

  try {
    const config = new Config({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_ENV: 'prod',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverEnv).toBe('prod')
    expect(config.deploymentDomain).toBe('hedra.local')
    expect(config.sqlitePath).toBe('.runtime/hedra.sqlite')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Config decodes true and false and rejects other boolean values', () => {
  for (const variable of ['HEDRA_SERVER_SILENT_STARTUP', 'HEDRA_SERVER_HTTP_LOGGING', 'HEDRA_SERVER_PRINT_ROUTES']) {
    for (const value of ['not-true', 'yes', '0', 'FALSE', 'tru']) {
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

test('Config rejects an invalid logging library, format or level', () => {
  for (const [variable, value] of [
    ['HEDRA_SERVER_LOG_LIBRARY', 'pretty'],
    ['HEDRA_SERVER_LOG_LIBRARY', 'unknown'],
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

test('Config does not mutate its supplied environment', () => {
  const env = Object.freeze({ HEDRA_SERVER_ENV: 'prod', HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const config = new Config(env)

  expect(config.serverEnv).toBe('prod')
  expect(env).toEqual({ HEDRA_SERVER_ENV: 'prod', HEDRA_SERVER_SILENT_STARTUP: 'true' })
})

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

test('Hedra uses Bun selected-file and ambient settings without options', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')
  const packageEntry = join(import.meta.dir, '../../src/hedra.ts')
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HEDRA_')))
  const script = `import { Hedra } from ${JSON.stringify(packageEntry)}; const app = new Hedra(); const other = new Hedra(); process.stdout.write(JSON.stringify({ port: app.port, hostname: app.hostname, separateConfig: app.config !== other.config, separateId: app.instanceId !== other.instanceId }))`

  await Bun.write(envPath, 'HEDRA_SERVER_LISTEN_PORT=9000\nHEDRA_SERVER_LISTEN_IP=127.0.0.2\n')

  try {
    const result = Bun.spawnSync(['bun', `--env-file=${envPath}`, '-e', script], {
      cwd: dir,
      env: {
        ...ambient,
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LISTEN_PORT: '8123',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({
      port: 8123,
      hostname: '127.0.0.2',
      separateConfig: true,
      separateId: true,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Hedra respects Bun disabling environment-file loading', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const packageEntry = join(import.meta.dir, '../../src/hedra.ts')
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HEDRA_')))
  const script = `import { Hedra } from ${JSON.stringify(packageEntry)}; process.stdout.write(String(new Hedra().port))`

  await Bun.write(join(dir, '.env'), 'HEDRA_SERVER_LISTEN_PORT=8123\n')

  try {
    const result = Bun.spawnSync(['bun', '--no-env-file', '-e', script], {
      cwd: dir,
      env: {
        ...ambient,
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LOG_LEVEL: 'silent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe('3000')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Hedra uses Bun automatic environment-file loading while explicit Config snapshots stay isolated', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const packageEntry = join(import.meta.dir, '../../src/hedra.ts')
  const ambient = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('HEDRA_')))
  const script = `import { Config, Hedra } from ${JSON.stringify(packageEntry)}; const app = new Hedra(); const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }); process.stdout.write(JSON.stringify({ appPort: app.port, snapshotPort: config.serverListenPort }))`

  await Bun.write(join(dir, '.env'), 'HEDRA_SERVER_LISTEN_PORT=8123\n')

  try {
    const result = Bun.spawnSync(['bun', '-e', script], {
      cwd: dir,
      env: {
        ...ambient,
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LOG_LEVEL: 'silent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({ appPort: 8123, snapshotPort: 3000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
