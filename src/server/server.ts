import type { Context, MiddlewareHandler } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import type { RequestScope } from '#models/request-scope.ts'
import type { RouteValidators } from '#routes/resources.ts'
import type { LoggerInterface } from '#server/logger.ts'
import { Config } from '#config'
import { AssociationOperations, associationTable } from '#controllers/associations.ts'
import { EnvironmentController } from '#controllers/environment-controller.ts'
import { TenantController } from '#controllers/tenant-controller.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { ConfigStore, environmentTable, tenantTable } from '#datastores/categories/config/config.ts'
import { modelIndexes } from '#datastores/indexes.ts'
import { ConfigurationError, ConnectionError } from '#errors'
import { Collection } from '#models/collection.ts'
import { Environment, EnvironmentChanges, EnvironmentInput } from '#models/environment.ts'
import { requireRequestScope } from '#models/request-scope.ts'
import { Tenant } from '#models/tenant.ts'
import { assertRouteValidators, guardedMiddleware, registerRoutes, routeHandler } from '#routes/resources.ts'
import { Logger } from '#server/logger.ts'
import { environmentMiddleware, tenantMiddleware } from '#server/request-scope.ts'

export type HedraOptions = {
  config?: Config
  backend?: Backend
  configDatastore?: ConfigDatastore
  logger?: LoggerInterface
}

export type ScopedHandler = (context: Context, scope: RequestScope) => Response | Promise<Response>

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
  private preparation: Promise<void> = Promise.resolve()
  private readonly environmentMiddleware: MiddlewareHandler

  readonly scoped = {
    get: (path: string, handler: ScopedHandler) => this.scopedRoute('get', path, handler),
    post: (path: string, handler: ScopedHandler) => this.scopedRoute('post', path, handler),
    put: (path: string, handler: ScopedHandler) => this.scopedRoute('put', path, handler),
    patch: (path: string, handler: ScopedHandler) => this.scopedRoute('patch', path, handler),
    delete: (path: string, handler: ScopedHandler) => this.scopedRoute('delete', path, handler),
  }

  /** Registers custom handlers with the same provisioning middleware as application CRUD. */
  private scopedRoute(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, handler: ScopedHandler): void {
    if (this.closed) throw new ConfigurationError('Hedra is closed')
    this[method](
      path,
      guardedMiddleware(this.environmentMiddleware),
      routeHandler(async (context) => handler(context, requireRequestScope(context))),
    )
  }

  /** Loads configuration and a logger and sets the listen address. */
  constructor(options: HedraOptions = {}) {
    super()
    this.instanceId = crypto.randomUUID()

    this.config = options.config ?? new Config()
    this.log = options.logger ?? new Logger(this.config, undefined, { instanceId: this.instanceId })

    this.port = this.config.serverListenPort
    this.hostname = this.config.serverListenIp
    this.backend = options.backend
    this.datastore = options.configDatastore
    this.environmentMiddleware = environmentMiddleware(this.config, () => this.configDatastore)

    const tenants = new Collection('tenants', Tenant)
    const tenantController = new TenantController(this.config, () => this.configDatastore)

    tenants.bindController(tenantController)
    registerRoutes(
      this,
      tenants,
      {
        create: Tenant.pick({ name: true, tenantDomain: true }),
        update: Tenant.pick({ name: true }).partial(),
        output: Tenant,
      },
      async (context, next) => {
        tenantController.assertHost(context)
        await next()
      },
      null,
    )

    const environments = new Collection('environments', Environment)

    environments.bindController(new EnvironmentController(() => this.configDatastore))
    registerRoutes(
      this,
      environments,
      { create: EnvironmentInput, update: EnvironmentChanges, output: Environment },
      tenantMiddleware(this.config, () => this.configDatastore),
      'tenantDomain',
    )

    this.associations = new AssociationOperations(
      () => {
        if (this.closed) throw new ConnectionError('Hedra is closed')
        if (!this.backend) throw new ConfigurationError('Register a collection before using associations')

        return this.guard(this.backend)
      },
      (name) => this.collections.get(name),
    )
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
   * this app's closed-state check on every call.
   *
   * Backend calls are asynchronous, but transaction callbacks and session methods
   * stay synchronous. Guard each layer so closing the app during a transaction
   * also blocks subsequent session operations.
   */
  private guard(backend: Backend, readiness: Promise<void> = this.preparation): Backend {
    /** Blocks operations after closure while keeping transaction sessions synchronous. */
    const guarded = <T>(operation: () => T): T => {
      if (this.closed) throw new ConnectionError('Datastore connection is closed')

      return operation()
    }
    /** Turns synchronous guard and dependency failures into rejected backend promises. */
    const guardedAsync = <T>(operation: () => Promise<T>): Promise<T> => {
      const pending = (async () => {
        guarded(() => undefined)
        await readiness

        return guarded(operation)
      })()

      // Failed graph construction can abandon controllers that already hold pending work.
      void readiness.catch(() => {
        void pending.catch(() => {})
      })

      return pending
    }

    return {
      ensureIndexes: (...args) => guardedAsync(() => backend.ensureIndexes(...args)),
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
  register<S extends z.ZodObject, C extends ControllerInterface>(
    collection: Collection<S, C>,
    validators: RouteValidators = {},
  ): void {
    if (this.closed) throw new ConfigurationError('Hedra is closed')
    if (!(collection instanceof Collection)) throw new ConfigurationError('Expected a Collection')
    if (this.collections.has(collection.name))
      throw new ConfigurationError(`Collection already registered: ${collection.name}`)

    assertRouteValidators(validators)
    const collectionsByName = new Map(this.collections)
    const pending: Collection[] = []
    const visiting = new Set<Collection>()
    const visited = new Set<Collection>()

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
      if (visited.has(candidate)) return
      const known = collectionsByName.get(candidate.name)

      if (known && known !== candidate) throw new ConfigurationError(`Collection already registered: ${candidate.name}`)
      if (known) return
      if ([tenantTable, environmentTable, associationTable, 'tenants', 'environments'].includes(candidate.name))
        throw new ConfigurationError('Collection name is reserved')
      const ownership = candidate.model.shape.environmentDomain

      if (!(ownership instanceof z.ZodString) || ownership.isOptional() || ownership.isNullable())
        throw new ConfigurationError('Application resources require environmentDomain')
      if (candidate.isAttached) throw new ConfigurationError('Collection is already attached to an app')

      collectionsByName.set(candidate.name, candidate)
      visiting.add(candidate)

      for (const target of candidate.associations) visit(target)

      visiting.delete(candidate)
      visited.add(candidate)
      pending.push(candidate)
    }

    visit(collection)
    const indexes = pending.map((item) => modelIndexes(item.model))

    if (this.config.serverPrintRoutes) {
      this.log.info(`Registering collection: ${collection.name}`)
    }

    const opened = this.backend === undefined

    if (opened) {
      const backend = new SqliteBackend(this.config.sqlitePath)

      this.backend = backend
      this.closeBackend = () => backend.close()
    }

    const registration = Promise.withResolvers<void>()
    const rawBackend = this.backend as Backend

    // Constructors receive their pending dependency before they can initiate asynchronous work.
    void registration.promise.catch(() => {})
    try {
      const backend = this.guard(rawBackend, registration.promise)
      const controllers = pending.map((item) => [item, item.createController(backend)] as const)
      const preparation = this.preparation.then(async () => {
        if (this.closed) throw new ConnectionError('Hedra is closed')
        await Promise.all(pending.map((item, index) => rawBackend.ensureIndexes(item.name, indexes[index] ?? [])))
      })

      this.preparation = registration.promise
      void preparation.then(registration.resolve, registration.reject)

      for (const [item, controller] of controllers) {
        item.bindController(controller)
        this.collections.set(item.name, item)
      }

      for (const item of pending)
        registerRoutes(this, item, item === collection ? validators : undefined, this.environmentMiddleware)
    } catch (error) {
      registration.reject(error)
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
    this.closeConfigDatastore?.()
    this.closeBackend?.()
  }
}
