import type { Database } from 'bun:sqlite'
import type { Logger } from 'pino'
import type { z } from 'zod'
import { Hono } from 'hono'

import { loadServerConfig } from '#config'
import { openDatabase } from '#datastores/sqlite.ts'
import { attachCollection, Collection, isAttached } from '#models/collection.ts'
import { loadAppLogger } from '#server/logging/logging.ts'

export class Hedra extends Hono {
  readonly config: Record<string, string>
  readonly log: Logger
  readonly port: number
  readonly hostname: string
  private database?: Database
  private readonly collectionNames = new Set<string>()
  private closed = false

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

  /** Attaches a collection to this app's shared database. */
  register<S extends z.ZodObject>(collection: Collection<S>): void {
    if (this.closed) throw new Error('Hedra is closed')
    if (!(collection instanceof Collection)) throw new TypeError('Expected a Collection')
    if (this.collectionNames.has(collection.name)) throw new Error(`Collection already registered: ${collection.name}`)
    if (isAttached(collection)) throw new Error('Collection is already attached to an app')

    this.database ??= openDatabase(this.config.sqlitePath as string)
    attachCollection(collection, this.database)
    this.collectionNames.add(collection.name)
  }

  /** Releases the shared database and ends the collection lifecycle. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.database?.close()
  }
}
