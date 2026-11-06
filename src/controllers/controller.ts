import { z } from 'zod'

import type { Backend, DatabaseRecord, DatabaseScalar } from '#datastores/backend.ts'
import { DatabaseFilter, DatabaseRecord as RecordSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { assertResourceModel, Resource } from '#models/resource.ts'

type Attributes<S extends z.ZodObject> = {
  [K in keyof z.input<S> as K extends 'id' ? never : K]: z.input<S>[K]
} & { id?: never }
type Filter<S extends z.ZodObject> = Partial<{
  [K in keyof z.output<S> as Exclude<z.output<S>[K], undefined> extends DatabaseScalar ? K : never]: z.output<S>[K]
}>

/** Serializes a value only when JSON preserves it without loss. */
function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new Error('Resource values must be JSON compatible')
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new Error('Resource values must be JSON compatible')

  return data
}

export class Controller<S extends z.ZodObject> {
  /** Uses the supplied model and backend for one named resource collection. */
  constructor(
    readonly name: string,
    readonly model: S,
    protected readonly backend: Backend,
  ) {
    assertResourceModel(model)
  }

  /** Parses and checks that a model remains valid across JSON storage. */
  private encode(input: unknown): { record: z.output<S>; stored: DatabaseRecord } {
    const id = Resource.parse(input).id
    const record = this.model.parse(input)
    const data = jsonString(record)
    const stored: unknown = JSON.parse(data)

    if (Resource.parse(stored).id !== id) throw new Error('Resource ID cannot change')
    if (!Bun.deepEquals(stored, this.model.parse(JSON.parse(data)))) {
      throw new Error('Resource model must produce stable JSON records')
    }

    const validated = RecordSchema.parse(stored)

    return { record, stored: { ...validated, ...(stored as DatabaseRecord) } }
  }

  /** Rejects externally supplied resource IDs. */
  private attributes(input: unknown): Record<string, unknown> {
    const attributes = z.record(z.string(), z.unknown()).parse(input)

    if (Object.hasOwn(input as object, 'id')) throw new Error('Resource ID is managed by the controller')

    return { ...attributes, ...(input as Record<string, unknown>) }
  }

  /** Creates a validated resource with a fresh ID. */
  async create(input: Attributes<S>): Promise<z.output<S>> {
    const attributes = this.attributes(input)
    const id = crypto.randomUUID()
    const { record, stored } = this.encode({ ...attributes, id })

    if (stored.id !== id) throw new Error('Resource ID cannot change')
    await this.backend.insert(this.name, stored)

    return record
  }

  /** Returns the addressed resource, or null when it is absent. */
  async get(id: string): Promise<z.output<S> | null> {
    const key = Resource.shape.id.parse(id)
    const rows = await this.backend.select(this.name, { id: key })

    if (!rows.length) return null
    const { record, stored } = this.encode(rows[0])

    if (stored.id !== key) throw new Error('Resource ID cannot change')

    return record
  }

  /** Returns resources matching the supplied scalar criteria. */
  async list(filter: Filter<S> = {}): Promise<z.output<S>[]> {
    if (Object.getOwnPropertySymbols(filter).length) throw new Error('Filter keys must be strings')
    DatabaseFilter.parse(filter)
    const entries = Object.entries(filter).map(([key, value]) => [key, ScalarSchema.parse(value)] as const)

    for (const [key, value] of entries) {
      if (!Object.hasOwn(this.model.shape, key)) throw new Error(`Invalid resource filter field: ${key}`)
      const field = this.model.shape[key]

      if (!field?.safeParse(value).success) throw new Error(`Invalid resource filter field: ${key}`)
    }

    return (await this.backend.select(this.name, Object.fromEntries(entries))).map((row) => this.encode(row).record)
  }

  /** Shallowly changes one existing resource while preserving its ID. */
  async update(id: string, changes: Partial<Attributes<S>>): Promise<z.output<S> | null> {
    const key = Resource.shape.id.parse(id)
    const attributes = this.attributes(changes)
    const patch: Record<string, unknown> = JSON.parse(jsonString(attributes))
    const result = await this.backend.update(this.name, key, (current) => {
      const previous = this.encode(current).stored
      const updated = this.encode({ ...previous, ...patch, id: key }).stored

      if (previous.id !== key || updated.id !== key) throw new Error('Resource ID cannot change')

      return updated
    })

    return result === null ? null : this.encode(result).record
  }

  /** Replaces one existing resource while preserving its ID. */
  async replace(id: string, input: Attributes<S>): Promise<z.output<S> | null> {
    const key = Resource.shape.id.parse(id)
    const attributes = this.attributes(input)
    const result = await this.backend.update(this.name, key, (current) => {
      const previous = this.encode(current).stored
      const replacement = this.encode({ ...attributes, id: key }).stored

      if (previous.id !== key || replacement.id !== key) throw new Error('Resource ID cannot change')

      return replacement
    })

    return result === null ? null : this.encode(result).record
  }

  /** Removes one resource and reports whether it existed. */
  async delete(id: string): Promise<boolean> {
    const key = Resource.shape.id.parse(id)

    return this.backend.delete(this.name, key)
  }
}
