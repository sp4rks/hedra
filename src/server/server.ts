import type { z } from 'zod'
import { Hono } from 'hono'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import type { LoggerInterface } from '#server/logger.ts'
import { Config } from '#config'
import { AssociationOperations, associationTable } from '#controllers/associations.ts'
import { TenantController } from '#controllers/tenant-controller.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { ConfigStore, tenantTable } from '#datastores/categories/config/config.ts'
import { ConfigurationError, ConnectionError, DatastoreError, HedraError, hedraError } from '#errors'
import { bindCollection, Collection, createCollectionController, isAttached } from '#models/collection.ts'
import { embeddedFields } from '#models/embedded.ts'
import { Tenant } from '#models/tenant.ts'
import { checkRoutes, registerAssociationRoutes, registerRoutes } from '#routes/resources.ts'
import { Logger } from '#server/logger.ts'

export type HedraOptions = {
  config?: Config
  backend?: Backend
  configDatastore?: ConfigDatastore
  logger?: LoggerInterface
}

export class Hedra extends Hono {
  readonly config: Config
  readonly log: LoggerInterface
  readonly instanceId: string
  readonly port: number
  readonly hostname: string
  readonly associations: AssociationOperations

  private backend?: Backend
  private datastore?: ConfigDatastore
  private closeConfigDatastore?: () => void
  private closeBackend?: () => void
  private readonly collections = new Map<string, Collection>()
  private closed = false

  /** Loads configuration and a logger and sets the listen address. */
  constructor(options: HedraOptions = {}) {
    super()
    try {
      this.instanceId = crypto.randomUUID()

      this.config = options.config ?? new Config()
      this.log = options.logger ?? new Logger(this.config, undefined, { instanceId: this.instanceId })

      this.port = this.config.serverListenPort
      this.hostname = this.config.serverListenIp
      this.backend = options.backend
      this.datastore = options.configDatastore

      const tenants = new Collection('tenants', Tenant)
      const tenantController = new TenantController(this.config, () => this.configDatastore)

      bindCollection(tenants, tenantController)
      registerRoutes(this, tenants, (context) => tenantController.assertHost(context))

      this.associations = new AssociationOperations(
        () => {
          if (this.closed) throw new ConnectionError('Hedra is closed')
          if (!this.backend) throw new ConfigurationError('Register a collection before using associations')

          return this.guard(this.backend)
        },
        (name) => this.collections.get(name),
      )
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Returns the app's configuration datastore. */
  get configDatastore(): ConfigDatastore {
    if (this.closed) throw new ConnectionError('Hedra is closed')
    if (!this.datastore) {
      const store = new ConfigStore({ config: this.config })

      this.datastore = store
      this.closeConfigDatastore = () => store.close()
    }

    return this.datastore
  }

  /**
   * Wraps the backend so controllers stop using it after this app closes.
   * Injected backends remain open for their owners, so saved controllers need
   * this app's closed-state check on every call. Existing Hedra errors are
   * preserved; other failures become DatastoreError with the original cause.
   *
   * Backend calls are asynchronous, but transaction callbacks and session methods
   * stay synchronous. Guard each layer so closing the app during a transaction
   * also blocks subsequent session operations.
   */
  private guard(backend: Backend): Backend {
    const guarded = <T>(operation: () => T): T => {
      try {
        if (this.closed) throw new ConnectionError('Datastore connection is closed')

        return operation()
      } catch (error) {
        throw hedraError(error, DatastoreError)
      }
    }
    const guardedAsync = async <T>(operation: () => Promise<T>): Promise<T> =>
      guarded(operation).catch((error) => {
        throw hedraError(error, DatastoreError)
      })

    return {
      insert: (...args) => guardedAsync(() => backend.insert(...args)),
      select: (...args) => guardedAsync(() => backend.select(...args)),
      update: (...args) => guardedAsync(() => backend.update(...args)),
      delete: (...args) => guardedAsync(() => backend.delete(...args)),
      transaction: (work) =>
        guardedAsync(() =>
          backend.transaction((transaction) =>
            guarded(() =>
              work({
                insert: (...args) => guarded(() => transaction.insert(...args)),
                select: (...args) => guarded(() => transaction.select(...args)),
                update: (...args) => guarded(() => transaction.update(...args)),
                delete: (...args) => guarded(() => transaction.delete(...args)),
              }),
            ),
          ),
        ),
    }
  }

  /** Constructs the selected controller using this app's backend. */
  register<S extends z.ZodObject, C extends ControllerInterface>(collection: Collection<S, C>): void {
    try {
      if (this.closed) throw new ConfigurationError('Hedra is closed')
      if (!(collection instanceof Collection)) throw new ConfigurationError('Expected a Collection')
      if (this.collections.has(collection.name))
        throw new ConfigurationError(`Collection already registered: ${collection.name}`)

      const collectionsByName = new Map(this.collections)
      const pending: Collection[] = []
      const visiting = new Set<Collection>()

      /**
       * Validates a collection and its association graph, queuing targets before their source.
       * This pass only changes local state; controllers and routes are created after
       * every reachable collection passes validation.
       *
       * The visiting set tracks the current recursion chain. Check it before reusing a
       * known collection so a cycle cannot be mistaken for a shared association target.
       */
      const visit = (candidate: Collection): void => {
        if (visiting.has(candidate)) throw new ConfigurationError('Cyclic association definitions are not supported')
        const known = collectionsByName.get(candidate.name)

        if (known && known !== candidate)
          throw new ConfigurationError(`Collection already registered: ${candidate.name}`)
        if (known) return
        if (candidate.name === tenantTable || candidate.name === associationTable || candidate.name === 'tenants')
          throw new ConfigurationError('Collection name is reserved')
        if (isAttached(candidate)) throw new ConfigurationError('Collection is already attached to an app')

        checkRoutes(candidate.model, candidate.outputValidator)

        const embeddedNames = new Set(embeddedFields(candidate.model).map((field) => field.name))
        const associationNames = new Set<string>()

        if (candidate.associations.length && embeddedNames.has('associations'))
          throw new ConfigurationError('Embedded path is reserved')

        for (const target of candidate.associations) {
          if (embeddedNames.has(target.name) || associationNames.has(target.name))
            throw new ConfigurationError(`Ambiguous association path: ${target.name}`)
          associationNames.add(target.name)
        }
        collectionsByName.set(candidate.name, candidate)
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

        throw hedraError(error, ConfigurationError)
      }
    } catch (error) {
      throw hedraError(error, ConfigurationError)
    }
  }

  /** Ends this app's controller lifecycle and closes its owned backend. */
  close(): void {
    try {
      if (this.closed) return
      this.closed = true
      this.closeConfigDatastore?.()
      this.closeBackend?.()
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }
}
