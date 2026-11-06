import { Hono } from 'hono'
import { TrieRouter } from 'hono/router/trie-router'
import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import type { Logger } from '#server/logging/logging.ts'
import { Config, Environment, validateConfig } from '#config'
import { AssociationOperations, associationTable } from '#controllers/associations.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { tenantTable } from '#datastores/categories/config/config.ts'
import { bindCollection, Collection, createCollectionController, isAttached } from '#models/collection.ts'
import { embeddedFields } from '#models/embedded.ts'
import { checkRoutes, registerAssociationRoutes, registerRoutes } from '#routes/resources.ts'
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
    ['insert', 'select', 'update', 'delete', 'transaction'].every(
      (method) => typeof Reflect.get(value, method) === 'function',
    ),
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
  private readonly collections = new Map<string, Collection>()
  private closed = false
  readonly associations: AssociationOperations

  /** Loads configuration and a logger and sets the listen address. */
  constructor(options: HedraOptions = {}) {
    super({ router: new TrieRouter() })

    const parsed = HedraOptions.parse(options)
    const config = parsed.config ?? new Config(parsed.env)
    const values = parsed.config ? validateConfig(config) : config

    this.config = config
    this.instanceId = crypto.randomUUID()
    this.log = LoggerValue.parse((parsed.logger ?? new PinoLogger(config)).child({ instanceId: this.instanceId }))
    this.port = values.serverListenPort
    this.hostname = values.serverListenIp
    this.backend = parsed.backend
    this.associations = new AssociationOperations(
      () => {
        if (this.closed) throw new Error('Hedra is closed')
        if (!this.backend) throw new Error('Register a collection before using associations')

        return this.guard(this.backend)
      },
      (name) => this.collections.get(name),
    )
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
      transaction: async (work) => {
        check()

        return backend.transaction((transaction) => {
          check()

          return work({
            insert: (...args) => {
              check()

              return transaction.insert(...args)
            },
            select: (...args) => {
              check()

              return transaction.select(...args)
            },
            update: (...args) => {
              check()

              return transaction.update(...args)
            },
            delete: (...args) => {
              check()

              return transaction.delete(...args)
            },
          })
        })
      },
    }
  }

  /** Constructs the selected controller using this app's backend. */
  register<S extends z.ZodObject, C extends ControllerInterface>(collection: Collection<S, C>): void {
    if (this.closed) throw new Error('Hedra is closed')
    if (!(collection instanceof Collection)) throw new TypeError('Expected a Collection')
    if (this.collections.has(collection.name)) throw new Error(`Collection already registered: ${collection.name}`)
    const names = new Map(this.collections)
    const pending: Collection[] = []
    const visiting = new Set<Collection>()
    const visit = (candidate: Collection): void => {
      if (visiting.has(candidate)) throw new Error('Cyclic association definitions are not supported')
      const known = names.get(candidate.name)

      if (known && known !== candidate) throw new Error(`Collection already registered: ${candidate.name}`)
      if (known) return
      if (candidate.name === tenantTable || candidate.name === associationTable)
        throw new Error('Collection name is reserved')
      if (isAttached(candidate)) throw new Error('Collection is already attached to an app')
      checkRoutes(candidate.model, candidate.outputValidator)
      const fields = new Set(embeddedFields(candidate.model).map((field) => field.name))
      const targets = new Set<string>()

      if (candidate.associations.length && fields.has('associations')) throw new Error('Embedded path is reserved')

      for (const target of candidate.associations) {
        if (fields.has(target.name) || targets.has(target.name))
          throw new Error(`Ambiguous association path: ${target.name}`)
        targets.add(target.name)
      }
      names.set(candidate.name, candidate)
      visiting.add(candidate)

      for (const target of candidate.associations) visit(target)
      visiting.delete(candidate)
      pending.push(candidate)
    }

    visit(collection)

    if (this.config.serverPrintRoutes) {
      this.log.info(`Registering collection: ${collection.name}`)
    }

    const opened = this.backend === undefined

    if (opened) {
      this.ownedBackend = new SqliteBackend(this.config.sqlitePath)
      this.backend = this.ownedBackend
    }

    try {
      const backend = this.guard(this.backend as Backend)
      const controllers = pending.map((item) => [item, createCollectionController(item, backend)] as const)

      for (const [item, controller] of controllers) {
        bindCollection(item, controller)
        this.collections.set(item.name, item)
      }

      for (const item of pending) registerRoutes(this, item)

      for (const item of pending) registerAssociationRoutes(this, item, this.associations)
    } catch (error) {
      if (opened) {
        this.ownedBackend?.close()
        this.ownedBackend = undefined
        this.backend = undefined
      }

      throw error
    }
  }

  /** Ends this app's controller lifecycle and closes its owned backend. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.ownedBackend?.close()
  }
}
