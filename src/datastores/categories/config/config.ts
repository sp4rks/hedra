import type { Backend } from '#datastores/backend.ts'
import type { ResourceOperations } from '#datastores/resource-operations.ts'
import { Config } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { TenantOperations } from '#datastores/categories/config/tenants.ts'
import { ConfigurationError, hedraError } from '#errors'
import { Collection } from '#models/collection.ts'
import { Tenant } from '#models/tenant.ts'

export const tenantTable = 'hedra_config_tenants'

/** Stores tenants with valid, immutable domains and atomic domain uniqueness. */
export interface ConfigDatastore {
  readonly tenants: Pick<ResourceOperations<Tenant>, 'create' | 'get' | 'list' | 'update' | 'replace' | 'delete'>
}

export type ConfigStoreOptions = {
  config?: Config
  backend?: Backend
}

export class ConfigStore implements ConfigDatastore {
  readonly tenants: ResourceOperations<Tenant>
  private closeBackend?: () => void

  /** Binds tenant operations to a supplied or configured backend. */
  constructor(options?: ConfigStoreOptions)
  constructor(backend: Backend)
  constructor(input: ConfigStoreOptions | Backend = {}) {
    try {
      const options = 'insert' in input ? { backend: input } : input
      let backend = options.backend

      if (!backend) {
        const owned = new SqliteBackend((options.config ?? new Config()).sqlitePath)

        backend = owned
        this.closeBackend = () => owned.close()
      }
      const tenants = new Collection(tenantTable, Tenant)

      this.tenants = new TenantOperations(tenants.name, backend)
    } catch (error) {
      throw hedraError(error, ConfigurationError)
    }
  }

  /** Closes an owned backend without closing a supplied backend. */
  close(): void {
    this.closeBackend?.()
    this.closeBackend = undefined
  }
}
