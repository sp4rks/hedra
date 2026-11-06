import type { Backend } from '#datastores/backend.ts'
import { ResourceOperations } from '#datastores/resource-operations.ts'
import { Collection } from '#models/collection.ts'
import { Tenant } from '#models/tenant.ts'

export const tenantTable = 'hedra_config_tenants'

export class ConfigStore {
  readonly tenants: ResourceOperations<Tenant>

  /** Binds tenant operations to the supplied backend. */
  constructor(backend: Backend) {
    const tenants = new Collection(tenantTable, Tenant)

    this.tenants = new ResourceOperations<Tenant>(tenants.name, backend)
  }
}
