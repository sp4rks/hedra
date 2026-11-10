import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'

import { Config, Logger } from '#hedra.ts'

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

test('Logger constructs without arguments from the process environment', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const script = `
    import { Logger } from ${JSON.stringify(entry)}
    const logger = new Logger()
    logger.debug('hidden')
    logger.info('visible')
  `
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
    env: {
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_FORMAT: 'json',
      HEDRA_SERVER_LOG_LEVEL: 'info',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  expect(result.stderr.toString()).toBe('')
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout.toString())).toMatchObject({ msg: 'visible' })
})

test('Logger emits configured default JSON/info output with initial context', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const output = captureScript(`
    import { Config, Logger } from ${JSON.stringify(entry)}
    const logger = new Logger(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), undefined, { instanceId: 'test-instance' })
    logger.debug('hidden')
    logger.info('visible')
  `)

  expect(JSON.parse(output)).toMatchObject({ msg: 'visible', instanceId: 'test-instance' })
})

test('Logger honors explicit library, format and level settings', () => {
  const entry = join(import.meta.dir, '../../src/hedra.ts')
  const output = captureScript(`
    import { Config, Logger } from ${JSON.stringify(entry)}
    const logger = new Logger(new Config({
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

test('Logger emits message-first structured JSON', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new Logger(config, captured.destination)

  logger.info('Server started', { port: 8080 })

  expect(JSON.parse(captured.text())).toMatchObject({ msg: 'Server started', port: 8080 })
})

test('Logger emits each level and filters below the configured threshold', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'trace' })
  const logger = new Logger(config, captured.destination, { instanceId: 'test-instance' })

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
  const warnings = new Logger(warningConfig, filtered.destination)

  warnings.info('hidden')
  warnings.warn('visible')
  expect(JSON.parse(filtered.text()).msg).toBe('visible')
})

test('Logger writes nothing at silent level', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' })
  const logger = new Logger(config, captured.destination)

  logger.fatal('hidden')

  expect(captured.text()).toBe('')
})

test('Logger writes a readable line in pretty format', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_FORMAT: 'pretty' })
  const logger = new Logger(config, captured.destination)

  logger.info('Server started')

  expect(captured.text()).toContain('Server started')
  expect(captured.text()).not.toContain('"msg"')
})

test('Logger copies initial context and per-call fields take precedence', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const bindings = { shared: 'initial', site: 'north' }
  const logger = new Logger(config, captured.destination, bindings)

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

test('Logger preserves error messages and stacks', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new Logger(config, captured.destination)

  logger.error('Database failed', { err: new Error('disk unavailable') })

  const record = JSON.parse(captured.text())

  expect(record.err.message).toBe('disk unavailable')
  expect(record.err.stack).toContain('disk unavailable')
})

test('Logger rejects structured fields that are not a string-keyed record', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const logger = new Logger(config, captured.destination)

  expect(() => logger.info('Invalid fields', [] as never)).toThrow()
  expect(() => new Logger(config, captured.destination, null as never)).toThrow()
  expect(() => new Logger(config, captured.destination, [] as never)).toThrow()
  expect(captured.text()).toBe('')
})
