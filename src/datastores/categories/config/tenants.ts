import type { z } from 'zod'

import type { TenantOperationsInterface } from '#datastores/categories/config/config.ts'
import { ResourceOperations } from '#datastores/resource-operations.ts'
import { InputValidationError, OutputValidationError, parseInput, UniqueViolationError } from '#errors'
import { ResourceId } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'

const TenantCreate = Tenant.omit({ id: true, createdAt: true, updatedAt: true })
const TenantUpdate = Tenant.pick({ name: true }).partial()

export type TenantCreate = z.infer<typeof TenantCreate>
export type TenantUpdate = z.infer<typeof TenantUpdate>

/** Validates a tenant read from the backend. */
function storedTenant(input: unknown): Tenant {
  const result = Tenant.safeParse(input)

  if (!result.success) throw new OutputValidationError('output validation error', result.error.issues)

  return result.data
}

export class TenantOperations extends ResourceOperations<Tenant> implements TenantOperationsInterface {
  /** Returns a validated tenant, or null when it is absent. */
  override async get(id: string): Promise<Tenant | null> {
    const tenant = await super.get(id)

    return tenant === null ? null : storedTenant(tenant)
  }

  /** Returns validated tenants matching the supplied scalar criteria. */
  override async list(filter: Partial<Tenant> = {}): Promise<Tenant[]> {
    return (await super.list(filter)).map(storedTenant)
  }

  /** Creates a tenant if its canonical domain is not already in use. */
  override async create(input: TenantCreate): Promise<Tenant> {
    const attributes = parseInput(TenantCreate, input)
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
  override async update(id: string, changes: TenantUpdate): Promise<Tenant | null> {
    const key = parseInput(ResourceId, id)
    const fields = parseInput(TenantUpdate, changes)
    const updated = await this.backend.update(this.name, key, (record) => {
      const current = storedTenant(record)

      if (current.id !== key) throw new OutputValidationError('Resource ID cannot change')

      return parseInput(Tenant, { ...current, ...fields, updatedAt: new Date().toISOString() })
    })

    return updated === null ? null : storedTenant(updated)
  }

  /** Replaces a tenant only when its domain stays unchanged. */
  override async replace(id: string, input: TenantCreate): Promise<Tenant | null> {
    const key = parseInput(ResourceId, id)
    const fields = parseInput(TenantCreate, input)
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
