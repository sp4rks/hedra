import type { Backend } from '#datastores/backend.ts'
import type { TenantCreate, TenantUpdate } from '#datastores/categories/config/tenants.ts'
import type { Environment, EnvironmentChanges, EnvironmentInput } from '#models/environment.ts'
import type { Tenant } from '#models/tenant.ts'
import { Config } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { EnvironmentOperations } from '#datastores/categories/config/environments.ts'
import { TenantOperations } from '#datastores/categories/config/tenants.ts'
import { modelIndexes } from '#datastores/indexes.ts'
import { ConfigurationError } from '#errors'
import { Environment as EnvironmentSchema } from '#models/environment.ts'
import { Tenant as TenantSchema } from '#models/tenant.ts'

export const tenantTable = 'hedra_config_tenants'
export const environmentTable = 'hedra_config_environments'

/** Describes the configuration catalogue's tenant operations. */
export interface TenantOperationsInterface {
  create(input: TenantCreate): Promise<Tenant>
  get(id: string): Promise<Tenant | null>
  list(filter?: Partial<Tenant>): Promise<Tenant[]>
  update(id: string, changes: TenantUpdate): Promise<Tenant | null>
  replace(id: string, input: TenantCreate): Promise<Tenant | null>
  delete(id: string): Promise<boolean>
}

/** Describes tenant-scoped environment catalogue operations. */
export interface EnvironmentOperationsInterface {
  create(tenantDomain: string, input: EnvironmentInput): Promise<Environment>
  get(tenantDomain: string, id: string): Promise<Environment | null>
  list(tenantDomain: string, filter?: Partial<Environment>): Promise<Environment[]>
  update(tenantDomain: string, id: string, changes: EnvironmentChanges): Promise<Environment | null>
  replace(tenantDomain: string, id: string, input: EnvironmentInput): Promise<Environment | null>
  delete(tenantDomain: string, id: string): Promise<boolean>
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
