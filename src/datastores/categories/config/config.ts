import { Tenant } from '#models/tenant.ts'

export interface ConfigBackend {
  /** Inserts a tenant and rejects an existing ID without replacing it. */
  insertTenant(tenant: Tenant): Promise<void>
}

export class ConfigStore {
  readonly tenants = {
    /** Validates and stores tenant configuration. */
    create: async (input: Tenant): Promise<Tenant> => {
      const tenant = Tenant.parse(input)

      await this.backend.insertTenant(tenant)

      return tenant
    },
  }

  /** Uses the supplied backend without owning its connection. */
  constructor(private readonly backend: ConfigBackend) {}
}
