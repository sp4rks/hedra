import type { z } from 'zod'
import { Hono } from 'hono'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import type { Logger } from '#server/logging/logging.ts'
import { Config, validateConfig } from '#config'
import { AssociationOperations, associationTable } from '#controllers/associations.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { tenantTable } from '#datastores/categories/config/config.ts'
import { ConnectionError } from '#errors'
import { bindCollection, Collection, createCollectionController, isAttached } from '#models/collection.ts'
import { embeddedFields } from '#models/embedded.ts'
import { checkRoutes, registerAssociationRoutes, registerRoutes } from '#routes/resources.ts'
import { PinoLogger } from '#server/logging/logging.ts'

export type HedraOptions = {
  config?: Config
  logger?: Logger
  backend?: Backend
}

export class Hedra extends Hono {
  readonly config: Config
  readonly log: Logger
  readonly instanceId: string
  readonly port: number
  readonly hostname: string
  private backend?: Backend
  private closeBackend?: () => void
  private readonly collections = new Map<string, Collection>()
  private closed = false
  readonly associations: AssociationOperations

  /** Loads configuration and a logger and sets the listen address. */
  constructor(options: HedraOptions = {}) {
    super()

    const config = options.config ?? new Config()
    const values = validateConfig(config)

    this.config = config
    this.instanceId = crypto.randomUUID()
    this.log = PinoLogger.create(config, options.logger).child({ instanceId: this.instanceId })
    this.port = values.serverListenPort
    this.hostname = values.serverListenIp
    this.backend = options.backend
    this.associations = new AssociationOperations(
      () => {
        if (this.closed) throw new ConnectionError('Hedra is closed')
        if (!this.backend) throw new Error('Register a collection before using associations')

        return this.guard(this.backend)
      },
      (name) => this.collections.get(name),
    )
  }

  /** Prevents a closed app's controllers from using a borrowed backend. */
  private guard(backend: Backend): Backend {
    const check = () => {
      if (this.closed) throw new ConnectionError('Datastore connection is closed')
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
      const backend = new SqliteBackend(this.config.sqlitePath)

      this.backend = backend
      this.closeBackend = () => backend.close()
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
        this.closeBackend?.()
        this.closeBackend = undefined
        this.backend = undefined
      }

      throw error
    }
  }

  /** Ends this app's controller lifecycle and closes its owned backend. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.closeBackend?.()
  }
}
