import { expect, test } from 'bun:test'

import { app } from '../src/index.ts'

test('GET /health returns ok', async () => {
  const response = await app.request('/health')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true })
})
