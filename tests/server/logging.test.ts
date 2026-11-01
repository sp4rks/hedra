import type { DestinationStream } from 'pino'
import { expect, test } from 'bun:test'
import { Writable } from 'node:stream'

import { loadAppLogger } from '#server/logging/logging.ts'

/** Collects logger output so a test can read the formatted line. */
function captureDestination(): { destination: DestinationStream; text: () => string } {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })

  return { destination, text: () => chunks.join('') }
}

const base = {
  serverLogLevel: 'info',
  instanceId: 'instance-1',
}

test('loadAppLogger writes JSON when the log type is pino', () => {
  const captured = captureDestination()
  const log = loadAppLogger({ ...base, serverLogType: 'pino' }, captured.destination)

  log.info('health check')

  expect(captured.text()).toContain('"msg":"health check"')
})

test('loadAppLogger pretty-prints when the log type is pino-pretty', () => {
  const captured = captureDestination()
  const log = loadAppLogger({ ...base, serverLogType: 'pino-pretty' }, captured.destination)

  log.info('health check')

  const line = captured.text()

  expect(line).toContain('health check')
  expect(line).not.toContain('"msg"')
})

test('loadAppLogger pretty-prints when the log type is dev', () => {
  const captured = captureDestination()
  const log = loadAppLogger({ ...base, serverLogType: 'dev' }, captured.destination)

  log.info('health check')

  const line = captured.text()

  expect(line).toContain('health check')
  expect(line).not.toContain('"msg"')
})
