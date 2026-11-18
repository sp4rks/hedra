import { expect, mock, test } from 'bun:test'

import type { LogFields, LoggerInterface } from '#hedra.ts'
import { Config, Hedra, Resource } from '#hedra.ts'
import { request } from '../fixtures/scope.ts'

/** Captures access records through the logger supplied by the application. */
function captureHttpLogs(settings: Record<string, string> = {}) {
  const config = new Config({
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SQLITE_PATH: ':memory:',
    ...settings,
  })
  const info = mock((_message: string, _fields?: LogFields) => {})
  const logger = { info, trace() {}, debug() {}, warn() {}, error() {}, fatal() {} } satisfies LoggerInterface
  const app = new Hedra({ config, logger })

  return { app, info }
}

test('custom POST logs one correlated completion using the route pattern and safe metadata', async () => {
  const { app, info } = captureHttpLogs()

  app.post('/hooks/:id', async (context) => new Response(await context.req.text(), { status: 202 }))
  const response = await app.request('/hooks/private-path?token=private-query', {
    method: 'POST',
    body: 'private-body',
    headers: { 'content-type': 'text/plain', authorization: 'Bearer private-header', 'x-request-id': 'client-id' },
  })

  expect(response.status).toBe(202)
  expect(await response.text()).toBe('private-body')
  expect(info.mock.calls).toEqual([
    [
      'HTTP request completed',
      {
        requestId: 'client-id',
        method: 'POST',
        path: '/hooks/:id',
        status: 202,
        durationMs: expect.any(Number),
      },
    ],
  ])
  expect(info.mock.calls[0]?.[1]?.durationMs).toBeGreaterThanOrEqual(0)
  expect(response.headers.get('x-request-id')).toBe('client-id')
  app.close()
})

test('built-in and generated collection routes both log completions', async () => {
  const { app, info } = captureHttpLogs()

  try {
    app.register(Resource.meta({ name: 'widgets' }))
    const tenants = await app.request('/tenants', { headers: { host: app.config.deploymentApiDomain } })
    const widgets = await request(app, '/widgets')

    expect(tenants.status).toBe(200)
    expect(widgets.status).toBe(200)
    expect(info.mock.calls.map(([, fields]) => fields)).toEqual([
      expect.objectContaining({ path: '/tenants', status: 200 }),
      expect.objectContaining({ path: '/widgets', status: 200 }),
    ])
  } finally {
    app.close()
  }
})

test('unmatched HEAD requests log 404 with a generated ID and wildcard path', async () => {
  const { app, info } = captureHttpLogs()
  const response = await app.request('/private-missing-path', {
    method: 'HEAD',
    headers: { 'x-request-id': 'invalid request id' },
  })
  const id = response.headers.get('x-request-id')

  expect(response.status).toBe(404)
  expect(response.body).toBeNull()
  expect(id).toMatch(/^[0-9a-f-]{36}$/i)
  expect(info.mock.calls).toEqual([
    ['HTTP request completed', expect.objectContaining({ requestId: id, method: 'HEAD', path: '/*', status: 404 })],
  ])
  app.close()
})

test('custom errors log the status returned by the application error handler', async () => {
  const { app, info } = captureHttpLogs()

  app.get('/broken', () => {
    throw new Error('private error details')
  })
  app.onError((_, context) => context.text('Unavailable', 503))
  const response = await app.request('/broken')

  expect(response.status).toBe(503)
  expect(await response.text()).toBe('Unavailable')
  expect(info.mock.calls).toEqual([
    [
      'HTTP request completed',
      {
        requestId: response.headers.get('x-request-id'),
        method: 'GET',
        path: '/broken',
        status: 503,
        durationMs: expect.any(Number),
      },
    ],
  ])
  app.close()
})

test('disabling HTTP logging skips access records and leaves application logging available', async () => {
  const { app, info } = captureHttpLogs({ HEDRA_SERVER_HTTP_LOGGING: 'false' })

  app.get('/custom', (context) => context.text('OK'))
  const response = await app.request('/custom', { headers: { 'x-request-id': 'client-id' } })

  app.log.info('Application event')
  expect(response.status).toBe(200)
  expect(response.headers.get('x-request-id')).toBeNull()
  expect(info.mock.calls).toEqual([['Application event']])
  app.close()
})
