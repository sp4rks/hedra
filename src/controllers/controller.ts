import { z } from 'zod'

import type { Backend, DatabaseRecord, DatabaseScalar } from '#datastores/backend.ts'
import type { Resource } from '#models/resource.ts'
import { DatabaseFilter, DatabaseRecord as RecordSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { ResourceId } from '#models/resource.ts'

type Attributes<T extends Resource> = {
  [K in keyof T as K extends 'id' ? never : K]: T[K]
} & { id?: never }
type Filter<T extends Resource> = Partial<{
  [K in keyof T as Exclude<T[K], undefined> extends DatabaseScalar ? K : never]: T[K]
}>

/** Serializes a value only when JSON preserves it without loss. */
function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new Error('Resource values must be JSON compatible')
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new Error('Resource values must be JSON compatible')

  return data
}

export class Controller<T extends Resource> {
  /** Uses the supplied backend for one named resource collection. */
  constructor(
    readonly name: string,
    protected readonly backend: Backend,
  ) {}

  /** Validates generic JSON storage and server-owned resource identity. */
  private record(input: unknown): DatabaseRecord {
    const stored: unknown = JSON.parse(jsonString(input))
    const validated = RecordSchema.parse(stored)

    ResourceId.parse(validated.id)

    return { ...validated, ...(stored as DatabaseRecord) }
  }

  /** Rejects externally supplied resource IDs. */
  private attributes(input: unknown): Record<string, unknown> {
    const attributes = z.record(z.string(), z.unknown()).parse(input)

    if (Object.hasOwn(input as object, 'id')) throw new Error('Resource ID is managed by the controller')

    return { ...attributes, ...(input as Record<string, unknown>) }
  }

  /** Creates a resource with a fresh ID. */
  async create(input: Attributes<T>): Promise<T> {
    const attributes = this.attributes(input)
    const id = crypto.randomUUID()
    const stored = this.record({ ...attributes, id })

    await this.backend.insert(this.name, stored)

    return stored as T
  }

  /** Returns the addressed resource, or null when it is absent. */
  async get(id: string): Promise<T | null> {
    const key = ResourceId.parse(id)
    const rows = await this.backend.select(this.name, { id: key })

    if (!rows.length) return null
    const stored = this.record(rows[0])

    if (stored.id !== key) throw new Error('Resource ID cannot change')

    return stored as T
  }

  /** Returns resources matching the supplied scalar criteria. */
  async list(filter: Filter<T> = {}): Promise<T[]> {
    if (Object.getOwnPropertySymbols(filter).length) throw new Error('Filter keys must be strings')
    DatabaseFilter.parse(filter)
    const entries = Object.entries(filter).map(([key, value]) => [key, ScalarSchema.parse(value)] as const)

    return (await this.backend.select(this.name, Object.fromEntries(entries))).map((row) => this.record(row) as T)
  }

  /** Shallowly changes one existing resource while preserving its ID. */
  async update(id: string, changes: Partial<Attributes<T>>): Promise<T | null> {
    const key = ResourceId.parse(id)
    const attributes = this.attributes(changes)
    const patch: Record<string, unknown> = JSON.parse(jsonString(attributes))
    const result = await this.backend.update(this.name, key, (current) => {
      const previous = this.record(current)

      if (previous.id !== key) throw new Error('Resource ID cannot change')

      return this.record({ ...previous, ...patch, id: key })
    })

    return result === null ? null : (this.record(result) as T)
  }

  /** Replaces one existing resource while preserving its ID. */
  async replace(id: string, input: Attributes<T>): Promise<T | null> {
    const key = ResourceId.parse(id)
    const attributes = this.attributes(input)
    const result = await this.backend.update(this.name, key, (current) => {
      const previous = this.record(current)

      if (previous.id !== key) throw new Error('Resource ID cannot change')

      return this.record({ ...attributes, id: key })
    })

    return result === null ? null : (this.record(result) as T)
  }

  /** Removes one resource and reports whether it existed. */
  async delete(id: string): Promise<boolean> {
    const key = ResourceId.parse(id)

    return this.backend.delete(this.name, key)
  }
}
