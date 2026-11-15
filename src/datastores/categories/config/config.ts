import type { Backend } from '#datastores/backend.ts'
import type { EnvironmentCreate, EnvironmentUpdate } from '#datastores/categories/config/environments.ts'
import type { TenantCreate, TenantUpdate } from '#datastores/categories/config/tenants.ts'
import type { Environment, Tenant } from '#models'
import { Config } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { EnvironmentOperations } from '#datastores/categories/config/environments.ts'
import { TenantOperations } from '#datastores/categories/config/tenants.ts'
import { modelIndexes } from '#datastores/indexes.ts'
import { ConfigurationError } from '#errors'
import { Environment as EnvironmentSchema, Tenant as TenantSchema } from '#models'

export const tenantTable = 'hedra_config_tenants'
export const environmentTable = 'hedra_config_environments'

/** Describes the configuration catalogue's tenant operations. */
export interface TenantOperationsInterface {
  create(input: TenantCreate): Promise<Tenant>
  get(tenantDomain: string): Promise<Tenant | null>
  list(filter?: Partial<Tenant>): Promise<Tenant[]>
  update(tenantDomain: string, changes: TenantUpdate): Promise<Tenant | null>
  replace(tenantDomain: string, input: TenantCreate): Promise<Tenant | null>
  delete(tenantDomain: string): Promise<boolean>
}

/** Describes tenant-scoped environment catalogue operations. */
export interface EnvironmentOperationsInterface {
  create(tenantDomain: string, input: EnvironmentCreate): Promise<Environment>
  get(tenantDomain: string, environmentDomain: string): Promise<Environment | null>
  list(tenantDomain: string, filter?: Partial<Environment>): Promise<Environment[]>
  update(tenantDomain: string, environmentDomain: string, changes: EnvironmentUpdate): Promise<Environment | null>
  replace(tenantDomain: string, environmentDomain: string, input: EnvironmentCreate): Promise<Environment | null>
  delete(tenantDomain: string, environmentDomain: string): Promise<boolean>
}

/** Stores tenants with valid, immutable domains and atomic domain uniqueness. */
export interface ConfigDatastore {
  readonly tenants: TenantOperationsInterface
  readonly environments: EnvironmentOperationsInterface
}

export type ConfigStoreOptions = {
  config?: Config
  backend?: Backend
}

export class ConfigStore implements ConfigDatastore {
  readonly tenants: TenantOperationsInterface
  readonly environments: EnvironmentOperationsInterface
  private closeBackend?: () => void

  /** Binds tenant operations to a supplied or configured backend. */
  constructor(options?: ConfigStoreOptions)
  constructor(backend: Backend)
  constructor(input: ConfigStoreOptions | Backend = {}) {
    if (!input || typeof input !== 'object') throw new ConfigurationError('Invalid configuration datastore options')
    const options = 'insert' in input ? { backend: input } : input
    let backend = options.backend

    if (!backend) {
      const owned = new SqliteBackend((options.config ?? new Config()).sqlitePath)

      backend = owned
      this.closeBackend = () => owned.close()
    }
    const ready = Promise.all([
      backend.ensureIndexes(tenantTable, modelIndexes(TenantSchema)),
      backend.ensureIndexes(environmentTable, modelIndexes(EnvironmentSchema)),
    ]).then(() => undefined)

    // Operations retain the rejected readiness promise without an unhandled rejection.
    void ready.catch(() => {})
    this.tenants = new TenantOperations(tenantTable, backend, environmentTable, ready)
    this.environments = new EnvironmentOperations(environmentTable, backend, tenantTable, ready)
  }

  /** Closes an owned backend without closing a supplied backend. */
  close(): void {
    this.closeBackend?.()
    this.closeBackend = undefined
  }
}
