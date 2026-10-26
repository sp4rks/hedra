import { Hono } from 'hono'
import { z } from 'zod'

import pino from 'pino'

const logger = pino()

const portSchema = z.coerce.number().int().min(1).max(65535).default(3000)

/** Reads the listen port from PORT, defaulting to 3000 when it is unset. */
export function readPort(env: NodeJS.ProcessEnv = process.env): number {
  return portSchema.parse(env.PORT)
}

export const app = new Hono()

app.get('/health', (context) => {
  logger.info('health check')
  return context.json({ ok: true })
})

/** Starts the HTTP server on the parsed port. */
export function start(port = readPort()): ReturnType<typeof Bun.serve> {
  logger.info({ port }, 'listening')
  return Bun.serve({
    port,
    fetch: app.fetch,
  })
}

if (import.meta.main) {
  start()
}
