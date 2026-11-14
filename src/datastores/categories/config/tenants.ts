import type { Backend } from '#datastores/backend.ts'
import type { TenantOperationsInterface } from '#datastores/categories/config/config.ts'
import type { TenantChanges, TenantInput } from '#models/tenant.ts'
import { catalogueRecord } from '#datastores/categories/config/records.ts'
import { ResourceOperations } from '#datastores/resource-operations.ts'
import { ConflictError, InputValidationError, OutputValidationError, parseInput, UniqueViolationError } from '#errors'
import { Environment } from '#models/environment.ts'
import { ResourceId } from '#models/resource.ts'
import { TenantChanges as ChangesSchema, TenantInput as InputSchema, Tenant } from '#models/tenant.ts'

export type TenantCreate = TenantInput
export type TenantUpdate = TenantChanges

export class TenantOperations extends ResourceOperations<Tenant> implements TenantOperationsInterface {
  /** Shares catalogue readiness and the table needed for atomic child checks. */
  constructor(
    name: string,
    backend: Backend,
    private readonly environmentTable: string,
    private readonly ready: Promise<void>,
  ) {
    super(name, backend)
  }

  /** Returns an active validated tenant, or null when absent or deleted. */
  override async get(id: string): Promise<Tenant | null> {
    await this.ready
    const key = parseInput(ResourceId, id)
    const record = (await this.backend.select(this.name, { id: key }))[0]

    if (!record) return null
    const current = catalogueRecord(Tenant, record)

    if (current.value.id !== key) throw new OutputValidationError('Resource ID cannot change')

    return current.deleted ? null : current.value
  }

  /** Returns active tenants matching declared scalar fields. */
  override async list(filter: Partial<Tenant> = {}): Promise<Tenant[]> {
    await this.ready
    const criteria = parseInput(Tenant.partial(), filter)
    const values = (await this.backend.select(this.name, criteria)).map((record) => catalogueRecord(Tenant, record))

    return values.filter((record) => !record.deleted).map((record) => record.value)
  }

  /** Creates a tenant while preserving every historical domain reservation. */
  override async create(input: TenantInput): Promise<Tenant> {
    await this.ready
    const fields = parseInput(InputSchema, input)
    const timestamp = new Date().toISOString()
    const tenant = parseInput(Tenant, {
      ...fields,
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

  /** Applies a validated mutation to the current active tenant atomically. */
  private async change(id: string, modify: (current: Tenant) => Tenant): Promise<Tenant | null> {
    await this.ready
    const key = parseInput(ResourceId, id)

    return await this.backend.transaction((transaction) => {
      const record = transaction.select(this.name, { id: key })[0]

      if (!record) return null
      const current = catalogueRecord(Tenant, record)

      if (current.deleted) return null
      if (current.value.id !== key) throw new OutputValidationError('Resource ID cannot change')
      const updated = parseInput(Tenant, modify(current.value))
      const result = transaction.update(this.name, key, () => updated)

      if (!result) throw new OutputValidationError('Backend did not apply the tenant update')
      const output = catalogueRecord(Tenant, result)

      if (output.deleted || output.value.id !== key || output.value.tenantDomain !== current.value.tenantDomain)
        throw new OutputValidationError('Tenant identity cannot change')

      return output.value
    })
  }

  /** Changes the tenant name while retaining its domain and metadata. */
  override async update(id: string, changes: TenantChanges): Promise<Tenant | null> {
    const fields = parseInput(ChangesSchema, changes)

    return this.change(id, (current) => ({ ...current, ...fields, updatedAt: new Date().toISOString() }))
  }

  /** Replaces public attributes without changing ownership or identity. */
  override async replace(id: string, input: TenantInput): Promise<Tenant | null> {
    const fields = parseInput(InputSchema, input)

    return this.change(id, (current) => {
      if (fields.tenantDomain !== current.tenantDomain) throw new InputValidationError('Tenant domain cannot change')

      return { ...current, ...fields, updatedAt: new Date().toISOString() }
    })
  }

  /** Reserves a deleted tenant domain after all active environments have been removed. */
  override async delete(id: string): Promise<boolean> {
    await this.ready
    const key = parseInput(ResourceId, id)

    return await this.backend.transaction((transaction) => {
      const record = transaction.select(this.name, { id: key })[0]

      if (!record) return false
      const current = catalogueRecord(Tenant, record)

      if (current.deleted) return false
      const environments = transaction.select(this.environmentTable, { tenantDomain: current.value.tenantDomain })

      if (environments.some((value) => !catalogueRecord(Environment, value).deleted))
        throw new ConflictError('tenant has active environments')
      const timestamp = new Date().toISOString()

      const result = transaction.update(this.name, key, () => ({
        ...current.value,
        updatedAt: timestamp,
        deletedAt: timestamp,
      }))

      if (!result) throw new OutputValidationError('Backend did not apply the tenant deletion')
      const deleted = catalogueRecord(Tenant, result)

      if (!deleted.deleted || deleted.value.id !== key || deleted.value.tenantDomain !== current.value.tenantDomain)
        throw new OutputValidationError('Backend did not preserve the deleted tenant identity')

      return true
    })
  }
}
