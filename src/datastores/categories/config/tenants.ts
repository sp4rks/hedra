import type { z } from 'zod'

import type { Backend } from '#datastores/backend.ts'
import type { TenantOperationsInterface } from '#datastores/categories/config/config.ts'
import { parseRecord } from '#datastores/categories/config/records.ts'
import { ResourceOperations } from '#datastores/resource-operations.ts'
import { ConflictError, InputValidationError, OutputValidationError, parseInput, UniqueViolationError } from '#errors'
import { Domain } from '#models/domain.ts'
import { Environment } from '#models/environment.ts'
import { Tenant } from '#models/tenant.ts'

export const TenantCreate = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantCreate = z.infer<typeof TenantCreate>

export const TenantUpdate = Tenant.pick({ name: true }).partial()

export type TenantUpdate = z.infer<typeof TenantUpdate>

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
  override async get(tenantDomain: string): Promise<Tenant | null> {
    await this.ready
    const key = parseInput(Domain, tenantDomain)
    const record = (await this.backend.select(this.name, { tenantDomain: key }))[0]

    if (!record) return null
    const current = parseRecord(Tenant, record)

    if (current.value.tenantDomain !== key) throw new OutputValidationError('Tenant identity cannot change')

    return current.deleted ? null : current.value
  }

  /** Returns active tenants matching declared scalar fields. */
  override async list(filter: Partial<Tenant> = {}): Promise<Tenant[]> {
    await this.ready
    const criteria = parseInput(Tenant.partial(), filter)
    const values = (await this.backend.select(this.name, criteria)).map((record) => parseRecord(Tenant, record))

    return values.filter((record) => !record.deleted).map((record) => record.value)
  }

  /** Creates a tenant while preserving every historical domain reservation. */
  override async create(input: TenantCreate): Promise<Tenant> {
    await this.ready
    const fields = parseInput(TenantCreate, input)
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
  private async change(tenantDomain: string, modify: (current: Tenant) => Tenant): Promise<Tenant | null> {
    await this.ready
    const key = parseInput(Domain, tenantDomain)

    return await this.backend.transaction((transaction) => {
      const record = transaction.select(this.name, { tenantDomain: key })[0]

      if (!record) return null
      const current = parseRecord(Tenant, record)

      if (current.deleted) return null
      if (current.value.tenantDomain !== key) throw new OutputValidationError('Tenant identity cannot change')
      const updated = parseInput(Tenant, modify(current.value))

      if (updated.id !== current.value.id || updated.tenantDomain !== key)
        throw new InputValidationError('Tenant identity cannot change')
      const result = transaction.update(this.name, current.value.id, () => updated)

      if (!result) throw new OutputValidationError('Backend did not apply the tenant update')
      const output = parseRecord(Tenant, result)

      if (
        output.deleted ||
        output.value.id !== current.value.id ||
        output.value.tenantDomain !== current.value.tenantDomain
      )
        throw new OutputValidationError('Tenant identity cannot change')

      return output.value
    })
  }

  /** Changes the tenant name while retaining its domain and metadata. */
  override async update(tenantDomain: string, changes: TenantUpdate): Promise<Tenant | null> {
    const fields = parseInput(TenantUpdate, changes)

    return this.change(tenantDomain, (current) => ({ ...current, ...fields, updatedAt: new Date().toISOString() }))
  }

  /** Replaces public attributes without changing ownership or identity. */
  override async replace(tenantDomain: string, input: TenantCreate): Promise<Tenant | null> {
    const fields = parseInput(TenantCreate, input)

    return this.change(tenantDomain, (current) => {
      if (fields.tenantDomain !== current.tenantDomain) throw new InputValidationError('Tenant domain cannot change')

      return { ...current, ...fields, updatedAt: new Date().toISOString() }
    })
  }

  /** Reserves a deleted tenant domain after all active environments have been removed. */
  override async delete(tenantDomain: string): Promise<boolean> {
    await this.ready
    const key = parseInput(Domain, tenantDomain)

    return await this.backend.transaction((transaction) => {
      const record = transaction.select(this.name, { tenantDomain: key })[0]

      if (!record) return false
      const current = parseRecord(Tenant, record)

      if (current.value.tenantDomain !== key) throw new OutputValidationError('Tenant identity cannot change')
      if (current.deleted) return false
      const environments = transaction.select(this.environmentTable, { tenantDomain: current.value.tenantDomain })

      if (environments.some((value) => !parseRecord(Environment, value).deleted))
        throw new ConflictError('tenant has active environments')
      const timestamp = new Date().toISOString()

      const result = transaction.update(this.name, current.value.id, () => ({
        ...current.value,
        updatedAt: timestamp,
        deletedAt: timestamp,
      }))

      if (!result) throw new OutputValidationError('Backend did not apply the tenant deletion')
      const deleted = parseRecord(Tenant, result)

      if (
        !deleted.deleted ||
        deleted.value.id !== current.value.id ||
        deleted.value.tenantDomain !== current.value.tenantDomain
      )
        throw new OutputValidationError('Backend did not preserve the deleted tenant identity')

      return true
    })
  }
}
