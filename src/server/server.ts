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
import { BaseController } from '#controllers/controller.ts'
import { EnvironmentController } from '#controllers/environment-controller.ts'
import { TenantController } from '#controllers/tenant-controller.ts'
import { AssociationOperations, associationTable } from '#datastores/associations.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { ConfigStore, environmentTable, tenantTable } from '#datastores/categories/config/config.ts'
import { modelIndexes } from '#datastores/indexes.ts'
import { ConfigurationError, ConnectionError } from '#errors'
import { environmentMiddleware, tenantMiddleware } from '#middleware/request-scope.ts'
import { assertChildren } from '#models/children.ts'
import { Environment } from '#models/environment.ts'
import { requireRequestScope } from '#models/request-scope.ts'
import { assertResourceModel, resourceName } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'
import { EnvironmentChanges, EnvironmentInput, TenantChanges, TenantInput } from '#routes/catalogue-inputs.ts'
import { assertRouteValidators, guardedMiddleware, registerRoutes, routeHandler } from '#routes/resources.ts'
import { Logger } from '#server/logger.ts'

export type HedraOptions = {
  config?: Config
  backend?: Backend
  configDatastore?: ConfigDatastore
  logger?: LoggerInterface
}

type ControllerConstructor<C extends ControllerInterface> = new (backend: Backend) => C

export type RegistrationOptions<C extends ControllerInterface = BaseController> = RouteValidators & {
  controller?: ControllerConstructor<C>
  associations?: z.ZodObject[]
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
  private readonly collections = new Map<
    string,
    { model: z.ZodObject; controller: ControllerInterface; associations: readonly z.ZodObject[] }
  >()
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

    const tenants = Tenant.meta({ name: 'tenants' })
    const tenantController = new TenantController(this.config, () => this.configDatastore)

    registerRoutes(
      this,
      tenants,
      tenantController,
      {
        create: TenantInput,
        update: TenantChanges,
        output: Tenant,
      },
      async (context, next) => {
        tenantController.assertHost(context)
        await next()
      },
      null,
    )

    const environments = Environment.meta({ name: 'environments' })

    registerRoutes(
      this,
      environments,
      new EnvironmentController(() => this.configDatastore),
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
        // Controllers accept a collection per call, including registrations newer than their own.
        await this.preparation

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

  /** Registers a named stored schema and returns its app-local controller. */
  register<C extends ControllerInterface>(
    model: z.ZodObject,
    options: RegistrationOptions<C> & { controller: ControllerConstructor<C> },
  ): C
  register(model: z.ZodObject, options?: RegistrationOptions<ControllerInterface>): ControllerInterface
  register<C extends ControllerInterface = BaseController>(
    model: z.ZodObject,
    options: RegistrationOptions<C> = {},
  ): C {
    if (this.closed) throw new ConfigurationError('Hedra is closed')
    const name = resourceName(model)

    if (this.collections.has(name)) throw new ConfigurationError(`Collection already registered: ${name}`)
    const parsedOptions = z
      .strictObject({
        controller: z.custom<ControllerConstructor<C>>((value) => typeof value === 'function').optional(),
        associations: z.array(z.instanceof(z.ZodObject)).optional(),
        create: z.instanceof(z.ZodObject).optional(),
        update: z.instanceof(z.ZodObject).optional(),
        output: z.instanceof(z.ZodObject).optional(),
      })
      .safeParse(options)

    if (!parsedOptions.success) throw new ConfigurationError('configuration error', parsedOptions.error.issues)
    const { controller: Constructor, associations = [], ...validators } = parsedOptions.data

    assertRouteValidators(validators)
    const definitions = [...associations, model]
    const pending: z.ZodObject[] = []
    const names = new Map<string, z.ZodObject>()

    for (const candidate of definitions) {
      const candidateName = resourceName(candidate)
      const known = this.collections.get(candidateName)?.model ?? names.get(candidateName)

      if (known && known !== candidate) throw new ConfigurationError(`Collection already registered: ${candidateName}`)
      if (known) continue
      if ([tenantTable, environmentTable, associationTable, 'tenants', 'environments'].includes(candidateName))
        throw new ConfigurationError('Collection name is reserved')
      assertResourceModel(candidate)
      assertChildren(candidate)
      names.set(candidateName, candidate)
      pending.push(candidate)
    }
    const indexes = pending.map(modelIndexes)

    if (this.config.serverPrintRoutes) this.log.info(`Registering collection: ${name}`)
    const opened = this.backend === undefined

    if (opened) {
      const backend = new SqliteBackend(this.config.sqlitePath)

      this.backend = backend
      this.closeBackend = () => backend.close()
    }
    const registration = Promise.withResolvers<void>()
    const rawBackend = this.backend as Backend

    // Constructor work depends on this registration before it can reach the backend.
    void registration.promise.catch(() => {})
    try {
      const backend = this.guard(rawBackend, registration.promise)
      const controllers = pending.map(
        (item) =>
          [item, item === model && Constructor ? new Constructor(backend) : new BaseController(backend)] as const,
      )
      const preparation = this.preparation.then(async () => {
        if (this.closed) throw new ConnectionError('Hedra is closed')
        await Promise.all(
          pending.map((item, index) => rawBackend.ensureIndexes(resourceName(item), indexes[index] ?? [])),
        )
      })

      this.preparation = registration.promise
      void preparation.then(registration.resolve, registration.reject)

      for (const [item, controller] of controllers)
        this.collections.set(resourceName(item), {
          model: item,
          controller,
          associations: item === model ? associations : [],
        })

      for (const [item, controller] of controllers)
        registerRoutes(this, item, controller, item === model ? validators : undefined, this.environmentMiddleware)

      return this.collections.get(name)?.controller as C
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
