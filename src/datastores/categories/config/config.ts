import type { Backend } from '#datastores/backend.ts'
import type { TenantCreate, TenantUpdate } from '#datastores/categories/config/tenants.ts'
import type { Tenant } from '#models/tenant.ts'
import { Config } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { TenantOperations } from '#datastores/categories/config/tenants.ts'
import { ConfigurationError } from '#errors'

export const tenantTable = 'hedra_config_tenants'

/** Describes the configuration catalogue's tenant operations. */
export interface TenantOperationsInterface {
  create(input: TenantCreate): Promise<Tenant>
  get(id: string): Promise<Tenant | null>
  list(filter?: Partial<Tenant>): Promise<Tenant[]>
  update(id: string, changes: TenantUpdate): Promise<Tenant | null>
  replace(id: string, input: TenantCreate): Promise<Tenant | null>
  delete(id: string): Promise<boolean>
}

/** Stores tenants with valid, immutable domains and atomic domain uniqueness. */
export interface ConfigDatastore {
  readonly tenants: TenantOperationsInterface
}

export type ConfigStoreOptions = {
  config?: Config
  backend?: Backend
}

export class ConfigStore implements ConfigDatastore {
  readonly tenants: TenantOperationsInterface
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
    this.tenants = new TenantOperations(tenantTable, backend)
  }

  /** Closes an owned backend without closing a supplied backend. */
  close(): void {
    this.closeBackend?.()
    this.closeBackend = undefined
  }
}
