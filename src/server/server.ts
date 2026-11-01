import type { Logger } from 'pino'
import { Hono } from 'hono'

import { loadServerConfig } from '#config'
import { loadAppLogger } from '#server/logging/logging.ts'

export class Hedra extends Hono {
  readonly config: Record<string, string>
  readonly log: Logger
  readonly port: number
  readonly hostname: string

  /** Loads configuration and a logger, registers the health route, and sets the listen address. */
  constructor(env: typeof Bun.env = process.env) {
    super()
    this.config = loadServerConfig(env)
    this.log = loadAppLogger(this.config)
    this.port = Number(this.config.serverListenPort)
    this.hostname = this.config.serverListenIp as string

    this.get('/health', (context) => {
      this.log.info('health check')
      return context.json({ ok: true })
    })
  }
}
