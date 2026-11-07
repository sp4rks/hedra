import { ResourceOperations } from '#datastores/resource-operations.ts'
import { InputValidationError, OutputValidationError, parseInput, UniqueViolationError } from '#errors'
import { ResourceId } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'

const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true }).strict()
const TenantChanges = TenantInput.omit({ tenantDomain: true }).partial()

/** Validates a tenant read from the backend. */
function storedTenant(input: unknown): Tenant {
  const result = Tenant.safeParse(input)

  if (!result.success) throw new OutputValidationError('output validation error', result.error.issues)

  return result.data
}

export class TenantOperations extends ResourceOperations<Tenant> {
  /** Creates a tenant if its canonical domain is not already in use. */
  override async create(input: Parameters<ResourceOperations<Tenant>['create']>[0]): Promise<Tenant> {
    const attributes = parseInput(TenantInput, input)
    const timestamp = new Date().toISOString()
    const tenant = parseInput(Tenant, {
      ...attributes,
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await this.backend.transaction((transaction) => {
      if (transaction.select(this.name, { tenantDomain: tenant.tenantDomain }).length) throw new UniqueViolationError()
      transaction.insert(this.name, tenant)
    })

    return tenant
  }

  /** Changes a tenant name while retaining its domain and managed metadata. */
  override async update(
    id: string,
    changes: Parameters<ResourceOperations<Tenant>['update']>[1],
  ): Promise<Tenant | null> {
    const key = parseInput(ResourceId, id)
    const fields = parseInput(TenantChanges, changes)
    const updated = await this.backend.update(this.name, key, (record) => {
      const current = storedTenant(record)

      if (current.id !== key) throw new OutputValidationError('Resource ID cannot change')

      return parseInput(Tenant, { ...current, ...fields, updatedAt: new Date().toISOString() })
    })

    return updated === null ? null : storedTenant(updated)
  }

  /** Replaces a tenant only when its domain stays unchanged. */
  override async replace(
    id: string,
    input: Parameters<ResourceOperations<Tenant>['replace']>[1],
  ): Promise<Tenant | null> {
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
  }
}
