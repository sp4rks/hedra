import { expect, test } from 'bun:test'

import { Hedra } from '#hedra.ts'

test('GET /health returns ok', async () => {
  const app = new Hedra({
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SERVER_LOG_LEVEL: 'silent',
  })
  const response = await app.request('/health')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
})
