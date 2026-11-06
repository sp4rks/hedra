import type { Controller } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import { attachCollection, Collection } from '#models/collection.ts'
import { Tenant } from '#models/tenant.ts'

export const tenantTable = 'hedra_config_tenants'

export class ConfigStore {
  readonly tenants: Controller<typeof Tenant>

  /** Binds tenant operations to the supplied backend. */
  constructor(backend: Backend) {
    const tenants = new Collection(tenantTable, Tenant)

    attachCollection(tenants, backend)
    this.tenants = tenants.controller
  }
}
