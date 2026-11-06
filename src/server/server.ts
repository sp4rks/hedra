import { Hono } from 'hono'
import { z } from 'zod'

import type { Controller } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import type { Logger } from '#server/logging/logging.ts'
import { Config, Environment, validateConfig } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { tenantTable } from '#datastores/categories/config/config.ts'
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
const BackendValue = z.custom<Backend>(
  (value) =>
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    ['insert', 'select', 'update', 'delete'].every((method) => typeof Reflect.get(value, method) === 'function'),
  'Expected a backend',
)
const HedraOptions = z
  .strictObject({
    env: EnvironmentInput.optional(),
    config: z.instanceof(Config).optional(),
    logger: LoggerValue.optional(),
    backend: BackendValue.optional(),
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
  private backend?: Backend
  private ownedBackend?: SqliteBackend
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
    this.backend = parsed.backend
  }

  /** Prevents a closed app's controllers from using a borrowed backend. */
  private guard(backend: Backend): Backend {
    const check = () => {
      if (this.closed) throw new Error('Hedra is closed')
    }

    return {
      insert: async (...args) => {
        check()

        return backend.insert(...args)
      },
      select: async (...args) => {
        check()

        return backend.select(...args)
      },
      update: async (...args) => {
        check()

        return backend.update(...args)
      },
      delete: async (...args) => {
        check()

        return backend.delete(...args)
      },
    }
  }

  /** Constructs the selected controller using this app's backend. */
  register<S extends z.ZodObject, C extends Controller<S>>(collection: Collection<S, C>): void {
    if (this.closed) throw new Error('Hedra is closed')
    if (!(collection instanceof Collection)) throw new TypeError('Expected a Collection')
    if (collection.name === tenantTable) throw new Error('Collection name is reserved for tenant configuration')
    if (this.collectionNames.has(collection.name)) throw new Error(`Collection already registered: ${collection.name}`)
    if (isAttached(collection)) throw new Error('Collection is already attached to an app')

    if (this.config.serverPrintRoutes) {
      this.log.info(`Registering collection: ${collection.name}`)
    }

    const opened = this.backend === undefined

    if (opened) {
      this.ownedBackend = new SqliteBackend(this.config.sqlitePath)
      this.backend = this.ownedBackend
    }

    try {
      attachCollection(collection, this.guard(this.backend as Backend))
    } catch (error) {
      if (opened) {
        this.ownedBackend?.close()
        this.ownedBackend = undefined
        this.backend = undefined
      }

      throw error
    }
    this.collectionNames.add(collection.name)
  }

  /** Ends this app's controller lifecycle and closes its owned backend. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.ownedBackend?.close()
  }
}
