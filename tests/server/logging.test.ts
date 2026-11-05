import { expect, test } from 'bun:test'
import { Writable } from 'node:stream'

import { Config, PinoLogger } from '#hedra.ts'

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
  const logger = new PinoLogger(config, captured.destination)

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

test('PinoLogger children isolate bindings and per-call fields take precedence', () => {
  const captured = captureDestination()
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const parent = new PinoLogger(config, captured.destination)
  const first = parent.child({ shared: 'parent', site: 'north' })
  const nested = first.child({ shared: 'child', depth: 2 })
  const sibling = parent.child({ site: 'south' })

  nested.info('nested', { shared: 'call' })
  first.info('first')
  sibling.info('sibling')
  parent.info('parent')

  const records = captured
    .text()
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))

  expect(records[0]).toMatchObject({ msg: 'nested', shared: 'call', site: 'north', depth: 2 })
  expect(
    captured
      .text()
      .split('\n')[0]
      ?.match(/"shared":/g),
  ).toHaveLength(1)
  expect(records[1]).toMatchObject({ msg: 'first', shared: 'parent', site: 'north' })
  expect(records[2]).toMatchObject({ msg: 'sibling', site: 'south' })
  expect(records[2]).not.toHaveProperty('shared')
  expect(records[3]).toMatchObject({ msg: 'parent' })
  expect(records[3]).not.toHaveProperty('site')
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
  expect(() => logger.child(null as never)).toThrow()
  expect(captured.text()).toBe('')
})
