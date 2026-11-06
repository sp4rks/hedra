import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { ConfigurationError } from '#errors'
import { Config, createLogger, PinoLogger } from '#hedra.ts'

/** Collects logger output through its public destination. */
function captureDestination(): { destination: Writable; text: () => string } {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })

  return { destination, text: () => chunks.join('') }
}

/** Captures a subprocess's standard output without a shared process-wide stream. */
function captureScript(script: string): string {
  const result = Bun.spawnSync(['bun', '-e', script], { stdout: 'pipe', stderr: 'pipe' })

  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)

  return result.stdout.toString()
}

test('createLogger emits configured default JSON/info output', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const output = captureScript(`
    import { Config, createLogger } from ${JSON.stringify(entry)}
    const logger = createLogger(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }))
    logger.debug('hidden')
    logger.info('visible')
  `)

  expect(JSON.parse(output)).toMatchObject({ msg: 'visible' })
})

test('createLogger binds initial context during creation', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const output = captureScript(`
    import { Config, createLogger } from ${JSON.stringify(entry)}
    const logger = createLogger(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), { instanceId: 'test-instance' })
    logger.info('Ready')
  `)

  expect(JSON.parse(output)).toMatchObject({ msg: 'Ready', instanceId: 'test-instance' })
})

test('createLogger honors explicit library, format and level settings', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const output = captureScript(`
    import { Config, createLogger } from ${JSON.stringify(entry)}
    const logger = createLogger(new Config({
      HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LIBRARY: 'pino',
      HEDRA_SERVER_LOG_FORMAT: 'pretty', HEDRA_SERVER_LOG_LEVEL: 'warn'
    }))
    logger.info('hidden')
    logger.warn('visible')
  `)

  expect(output).toContain('visible')
  expect(output).not.toContain('hidden')
  expect(output).not.toContain('"msg"')
})

test('Hedra selects its logger library from the environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-logging-'))
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const script = `
    import { Hedra } from ${JSON.stringify(entry)}
    const app = new Hedra()
    app.log.info('Ready', { expectedInstanceId: app.instanceId })
  `

  try {
    const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
      cwd: dir,
      env: {
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LOG_LIBRARY: 'pino',
        HEDRA_SERVER_LOG_FORMAT: 'json',
        HEDRA_SERVER_LOG_LEVEL: 'info',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.stderr.toString()).toBe('')
    expect(result.exitCode).toBe(0)
    const record = JSON.parse(result.stdout.toString())

    expect(record.msg).toBe('Ready')
    expect(record.instanceId).toBe(record.expectedInstanceId)
    expect(record.instanceId).toMatch(/^[0-9a-f-]{36}$/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('PinoLogger emits message-first structured JSON', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new PinoLogger(config, captured.destination)

  logger.info('Server started', { port: 8080 })

  expect(JSON.parse(captured.text())).toMatchObject({ msg: 'Server started', port: 8080 })
})

test('PinoLogger emits each level and filters below the configured threshold', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'trace' })
  const logger = new PinoLogger(config, captured.destination, { instanceId: 'test-instance' })

  logger.trace('trace')
  logger.debug('debug')
  logger.info('info')
  logger.warn('warn')
  logger.error('error')
  logger.fatal('fatal')

  const records = captured
    .text()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  expect(records.map((record) => record.msg)).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
  expect(records.map((record) => record.instanceId)).toEqual(Array(6).fill('test-instance'))

  const filtered = captureDestination()
  const warningConfig = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'warn' })
  const warnings = new PinoLogger(warningConfig, filtered.destination)

  warnings.info('hidden')
  warnings.warn('visible')
  expect(JSON.parse(filtered.text()).msg).toBe('visible')
})

test('PinoLogger writes nothing at silent level', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' })
  const logger = new PinoLogger(config, captured.destination)

  logger.fatal('hidden')

  expect(captured.text()).toBe('')
})

test('PinoLogger writes a readable line in pretty format', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_FORMAT: 'pretty' })
  const logger = new PinoLogger(config, captured.destination)

  logger.info('Server started')

  expect(captured.text()).toContain('Server started')
  expect(captured.text()).not.toContain('"msg"')
})

test('PinoLogger copies initial context and per-call fields take precedence', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const bindings = { shared: 'initial', site: 'north' }
  const logger = new PinoLogger(config, captured.destination, bindings)

  bindings.site = 'south'
  logger.info('first', { shared: 'call' })
  logger.warn('second')

  const records = captured
    .text()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  expect(records[0]).toMatchObject({ msg: 'first', shared: 'call', site: 'north' })
  expect(
    captured
      .text()
      .split('\n')[0]
      ?.match(/"shared":/g),
  ).toHaveLength(1)
  expect(records[1]).toMatchObject({ msg: 'second', shared: 'initial', site: 'north' })
})

test('PinoLogger preserves error messages and stacks', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new PinoLogger(config, captured.destination)

  logger.error('Database failed', { err: new Error('disk unavailable') })

  const record = JSON.parse(captured.text())

  expect(record.err.message).toBe('disk unavailable')
  expect(record.err.stack).toContain('disk unavailable')
})

test('PinoLogger rejects structured fields that are not a string-keyed record', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new PinoLogger(config, captured.destination)

  expect(() => logger.info('Invalid fields', [] as never)).toThrow()
  expect(() => new PinoLogger(config, captured.destination, null as never)).toThrow()
  expect(() => new PinoLogger(config, captured.destination, [] as never)).toThrow()
  expect(() => createLogger(config, null as never)).toThrow()
  expect(() => createLogger(config, [] as never)).toThrow()
  expect(captured.text()).toBe('')
})

test('PinoLogger rejects invalid configuration supplied by a subclass', () => {
  class InvalidConfig extends Config {
    override readonly serverListenPort = 0
  }

  const captured = captureDestination()
  const config = new InvalidConfig({ HEDRA_SERVER_SILENT_STARTUP: 'true' })

  expect(() => new PinoLogger(config, captured.destination)).toThrow(ConfigurationError)
  expect(captured.text()).toBe('')
})
