import { ResourceOperations } from '#datastores/resource-operations.ts'
import { hedraError, InputValidationError, OutputValidationError, parseInput, UniqueViolationError } from '#errors'
import { ResourceId } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'

const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true }).strict()
const TenantChanges = TenantInput.omit({ tenantDomain: true }).partial()

/** Validates a tenant read from the backend. */
function storedTenant(input: unknown): Tenant {
  try {
    return Tenant.parse(input)
  } catch (error) {
    throw hedraError(error, OutputValidationError)
  }
}

export class TenantOperations extends ResourceOperations<Tenant> {
  /** Creates a tenant if its canonical domain is not already in use. */
  override async create(input: Parameters<ResourceOperations<Tenant>['create']>[0]): Promise<Tenant> {
    try {
      const attributes = parseInput(TenantInput, input)
      const timestamp = new Date().toISOString()
      const tenant = Tenant.parse({
        ...attributes,
        id: crypto.randomUUID(),
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      await this.backend.transaction((transaction) => {
        if (transaction.select(this.name, { tenantDomain: tenant.tenantDomain }).length)
          throw new UniqueViolationError()
        transaction.insert(this.name, tenant)
      })

      return tenant
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Changes a tenant name while retaining its domain and managed metadata. */
  override async update(
    id: string,
    changes: Parameters<ResourceOperations<Tenant>['update']>[1],
  ): Promise<Tenant | null> {
    try {
      const key = parseInput(ResourceId, id)
      const fields = parseInput(TenantChanges, changes)
      const updated = await this.backend.update(this.name, key, (record) => {
        const current = storedTenant(record)

        if (current.id !== key) throw new OutputValidationError('Resource ID cannot change')

        return parseInput(Tenant, { ...current, ...fields, updatedAt: new Date().toISOString() })
      })

      return updated === null ? null : storedTenant(updated)
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Replaces a tenant only when its domain stays unchanged. */
  override async replace(
    id: string,
    input: Parameters<ResourceOperations<Tenant>['replace']>[1],
  ): Promise<Tenant | null> {
    try {
      const key = parseInput(ResourceId, id)
      const fields = parseInput(TenantInput, input)
      const updated = await this.backend.update(this.name, key, (record) => {
        const current = storedTenant(record)

        if (current.id !== key) throw new OutputValidationError('Resource ID cannot change')
        if (fields.tenantDomain !== current.tenantDomain) throw new InputValidationError('Tenant domain cannot change')

        return parseInput(Tenant, {
          ...fields,
          id: key,
          createdAt: current.createdAt,
          updatedAt: new Date().toISOString(),
        })
      })

      return updated === null ? null : storedTenant(updated)
    } catch (error) {
      throw hedraError(error)
    }
  }
}
