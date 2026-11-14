import type { z } from 'zod'

import type { Backend, BackendTransaction } from '#datastores/backend.ts'
import type { EnvironmentOperationsInterface } from '#datastores/categories/config/config.ts'
import { catalogueRecord } from '#datastores/categories/config/records.ts'
import {
  InputValidationError,
  OutputValidationError,
  parseInput,
  RecordNotFoundError,
  UniqueViolationError,
} from '#errors'
import { Domain, isDirectDomain } from '#models/domain.ts'
import { Environment } from '#models/environment.ts'
import { ResourceId } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'

export const EnvironmentCreate = Environment.pick({ name: true, environmentDomain: true })

export type EnvironmentCreate = z.infer<typeof EnvironmentCreate>

export const EnvironmentUpdate = Environment.pick({ name: true }).partial()

export type EnvironmentUpdate = z.infer<typeof EnvironmentUpdate>

export class EnvironmentOperations implements EnvironmentOperationsInterface {
  /** Shares catalogue storage, preparation and tenant ownership checks. */
  constructor(
    private readonly name: string,
    private readonly backend: Backend,
    private readonly tenantTable: string,
    private readonly ready: Promise<void>,
  ) {}

  /** Requires the owning tenant to remain active within the same configuration transaction. */
  private assertTenant(transaction: BackendTransaction, tenantDomain: string): void {
    const record = transaction.select(this.tenantTable, { tenantDomain })[0]

    if (!record) throw new RecordNotFoundError()
    const tenant = catalogueRecord(Tenant, record)

    if (tenant.value.tenantDomain !== tenantDomain) throw new OutputValidationError('Tenant identity cannot change')
    if (tenant.deleted) throw new RecordNotFoundError()
  }

  /** Validates the complete stored value and its immutable tenant relationship. */
  private record(input: unknown, owner: string, id?: string) {
    const current = catalogueRecord(Environment, input)

    if (
      current.value.tenantDomain !== owner ||
      (id !== undefined && current.value.id !== id) ||
      !isDirectDomain(current.value.environmentDomain, owner)
    )
      throw new OutputValidationError('Environment identity cannot change')

    return current
  }

  /** Creates an environment beneath its active tenant and reserves a unique domain. */
  async create(tenantDomain: string, input: EnvironmentCreate): Promise<Environment> {
    await this.ready
    const owner = parseInput(Domain, tenantDomain)
    const fields = parseInput(EnvironmentCreate, input)

    if (!isDirectDomain(fields.environmentDomain, owner))
      throw new InputValidationError('Environment domain must be a direct subdomain of its tenant')
    const timestamp = new Date().toISOString()
    const environment = parseInput(Environment, {
      ...fields,
      tenantDomain: owner,
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await this.backend.transaction((transaction) => {
      this.assertTenant(transaction, owner)
      if (transaction.select(this.name, { environmentDomain: environment.environmentDomain }).length)
        throw new UniqueViolationError()
      transaction.insert(this.name, environment)
    })

    return environment
  }

  /** Returns an active environment only within the selected tenant. */
  async get(tenantDomain: string, id: string): Promise<Environment | null> {
    await this.ready
    const owner = parseInput(Domain, tenantDomain)
    const key = parseInput(ResourceId, id)

    return await this.backend.transaction((transaction) => {
      this.assertTenant(transaction, owner)
      const record = transaction.select(this.name, { id: key, tenantDomain: owner })[0]

      if (!record) return null
      const current = this.record(record, owner, key)

      if (current.value.id !== key || current.value.tenantDomain !== owner)
        throw new OutputValidationError('Environment identity cannot change')

      return current.deleted ? null : current.value
    })
  }

  /** Lists active environments without allowing filters to replace tenant ownership. */
  async list(tenantDomain: string, filter: Partial<Environment> = {}): Promise<Environment[]> {
    await this.ready
    const owner = parseInput(Domain, tenantDomain)
    const criteria = parseInput(Environment.omit({ tenantDomain: true }).partial(), filter)

    return await this.backend.transaction((transaction) => {
      this.assertTenant(transaction, owner)
      const records = transaction
        .select(this.name, { ...criteria, tenantDomain: owner })
        .map((record) => this.record(record, owner))

      if (records.some((record) => record.value.tenantDomain !== owner))
        throw new OutputValidationError('Environment ownership cannot change')

      return records.filter((record) => !record.deleted).map((record) => record.value)
    })
  }

  /** Changes one active environment while preserving its tenant and domain. */
  private async change(
    tenantDomain: string,
    id: string,
    modify: (current: Environment) => Environment,
  ): Promise<Environment | null> {
    await this.ready
    const owner = parseInput(Domain, tenantDomain)
    const key = parseInput(ResourceId, id)

    return await this.backend.transaction((transaction) => {
      this.assertTenant(transaction, owner)
      const record = transaction.select(this.name, { id: key, tenantDomain: owner })[0]

      if (!record) return null
      const current = this.record(record, owner, key)

      if (current.value.id !== key || current.value.tenantDomain !== owner)
        throw new OutputValidationError('Environment identity cannot change')
      if (current.deleted) return null
      const updated = parseInput(Environment, modify(current.value))

      if (
        updated.id !== key ||
        updated.tenantDomain !== owner ||
        updated.environmentDomain !== current.value.environmentDomain
      )
        throw new InputValidationError('Environment ownership cannot change')
      const result = transaction.update(this.name, key, () => updated)

      if (!result) throw new OutputValidationError('Backend did not apply the environment update')
      const output = this.record(result, owner, key)

      if (
        output.deleted ||
        output.value.id !== key ||
        output.value.tenantDomain !== owner ||
        output.value.environmentDomain !== current.value.environmentDomain
      )
        throw new OutputValidationError('Environment identity cannot change')

      return output.value
    })
  }

  /** Changes only the environment name. */
  async update(tenantDomain: string, id: string, changes: EnvironmentUpdate): Promise<Environment | null> {
    const fields = parseInput(EnvironmentUpdate, changes)

    return this.change(tenantDomain, id, (current) => ({ ...current, ...fields, updatedAt: new Date().toISOString() }))
  }

  /** Replaces attributes while retaining the immutable environment domain. */
  async replace(tenantDomain: string, id: string, input: EnvironmentCreate): Promise<Environment | null> {
    const fields = parseInput(EnvironmentCreate, input)

    return this.change(tenantDomain, id, (current) => ({ ...current, ...fields, updatedAt: new Date().toISOString() }))
  }

  /** Hides an environment while retaining its domain reservation and application data. */
  async delete(tenantDomain: string, id: string): Promise<boolean> {
    await this.ready
    const owner = parseInput(Domain, tenantDomain)
    const key = parseInput(ResourceId, id)

    return await this.backend.transaction((transaction) => {
      this.assertTenant(transaction, owner)
      const record = transaction.select(this.name, { id: key, tenantDomain: owner })[0]

      if (!record) return false
      const current = this.record(record, owner, key)

      if (current.value.id !== key || current.value.tenantDomain !== owner)
        throw new OutputValidationError('Environment identity cannot change')
      if (current.deleted) return false
      const timestamp = new Date().toISOString()

      const result = transaction.update(this.name, key, () => ({
        ...current.value,
        updatedAt: timestamp,
        deletedAt: timestamp,
      }))

      if (!result) throw new OutputValidationError('Backend did not apply the environment deletion')
      const deleted = this.record(result, owner, key)

      if (!deleted.deleted || deleted.value.environmentDomain !== current.value.environmentDomain)
        throw new OutputValidationError('Backend did not preserve the deleted environment identity')

      return true
    })
  }
}
