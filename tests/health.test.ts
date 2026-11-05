import { expect, test } from 'bun:test'

import { Hedra } from '#hedra.ts'

test('Hedra provides no built-in health route', async () => {
  const app = new Hedra({
    env: {
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    },
  })
  const response = await app.request('/health')

  expect(response.status).toBe(404)
})
