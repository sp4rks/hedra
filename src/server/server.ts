import type { Logger } from 'pino'
import { Hono } from 'hono'

import { loadServerConfig } from '#config'
import { loadAppLogger } from '#server/logging/logging.ts'

export class Hedra extends Hono {
  readonly config: Record<string, string>
  readonly log: Logger

  /** Loads configuration and a logger for this app, and registers the health route. */
  constructor(env: typeof Bun.env = process.env) {
    super()
    this.config = loadServerConfig(env)
    this.log = loadAppLogger(this.config)

    this.get('/health', (context) => {
      this.log.info('health check')
      return context.json({ ok: true })
    })
  }
}
