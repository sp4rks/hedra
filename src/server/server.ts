import type { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Logger } from '#server/logging/logging.ts'
import { Config, Environment, validateConfig } from '#config'
import { openDatabase } from '#datastores/sqlite.ts'
import { attachCollection, Collection, isAttached } from '#models/collection.ts'
import { PinoLogger } from '#server/logging/logging.ts'

const EnvironmentInput = z.custom<typeof Bun.env>(
  (value) => Environment.safeParse(value).success,
  'Expected an environment map',
)
const LoggerValue = z.custom<Logger>(
  (value) =>
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'child'].every(
      (method) => typeof Reflect.get(value, method) === 'function',
    ),
  'Expected a logger',
)
const HedraOptions = z
  .strictObject({
    env: EnvironmentInput.optional(),
    config: z.instanceof(Config).optional(),
    logger: LoggerValue.optional(),
  })
  .refine((options) => options.env === undefined || options.config === undefined, {
    message: 'Provide either env or config, not both',
  })

export type HedraOptions = z.infer<typeof HedraOptions>

export class Hedra extends Hono {
  readonly config: Config
  readonly log: Logger
  readonly instanceId: string
  readonly port: number
  readonly hostname: string
  private database?: Database
  private readonly collectionNames = new Set<string>()
  private closed = false

  /** Loads configuration and a logger and sets the listen address. */
  constructor(options: HedraOptions = {}) {
    super()

    const parsed = HedraOptions.parse(options)
    const config = parsed.config ?? new Config(parsed.env)
    const values = parsed.config ? validateConfig(config) : config

    this.config = config
    this.instanceId = crypto.randomUUID()
    this.log = LoggerValue.parse((parsed.logger ?? new PinoLogger(config)).child({ instanceId: this.instanceId }))
    this.port = values.serverListenPort
    this.hostname = values.serverListenIp
  }

  /** Attaches a collection to this app's shared database. */
  register<S extends z.ZodObject>(collection: Collection<S>): void {
    if (this.closed) throw new Error('Hedra is closed')
    if (!(collection instanceof Collection)) throw new TypeError('Expected a Collection')
    if (this.collectionNames.has(collection.name)) throw new Error(`Collection already registered: ${collection.name}`)
    if (isAttached(collection)) throw new Error('Collection is already attached to an app')

    this.database ??= openDatabase(this.config.sqlitePath)
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
