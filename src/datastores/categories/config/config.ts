import type { Backend } from '#datastores/backend.ts'
import { Config } from '#config'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { ResourceOperations } from '#datastores/resource-operations.ts'
import { Collection } from '#models/collection.ts'
import { Tenant } from '#models/tenant.ts'

export const tenantTable = 'hedra_config_tenants'

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
    const options = 'insert' in input ? { backend: input } : input
    let backend = options.backend

    if (!backend) {
      const owned = new SqliteBackend((options.config ?? new Config()).sqlitePath)

      backend = owned
      this.closeBackend = () => owned.close()
    }
    const tenants = new Collection(tenantTable, Tenant)

    this.tenants = new ResourceOperations<Tenant>(tenants.name, backend)
  }

  /** Closes an owned backend without closing a supplied backend. */
  close(): void {
    this.closeBackend?.()
    this.closeBackend = undefined
  }
}
