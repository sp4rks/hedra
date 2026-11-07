import { z } from 'zod'

import type { Backend, DatabaseRecord, DatabaseScalar } from '#datastores/backend.ts'
import { DatabaseFilter, DatabaseRecord as RecordSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { HedraError, hedraError, InputValidationError, OutputValidationError, parseInput } from '#errors'
import { ResourceId, ResourceTimestamp } from '#models/resource.ts'

type Attributes<T> = {
  [K in keyof T as K extends 'id' | 'createdAt' | 'updatedAt' ? never : K]: T[K]
} & { id?: never; createdAt?: never; updatedAt?: never }
type Filter<T> = Partial<{
  [K in keyof T as Exclude<T[K], undefined> extends DatabaseScalar ? K : never]: T[K]
}>

/** Serializes a value only when JSON preserves it without loss. */
function jsonString(value: unknown, ErrorClass: typeof HedraError = InputValidationError): string {
  try {
    const data = JSON.stringify(value)

    if (data === undefined) throw new ErrorClass('Resource values must be JSON compatible')
    z.json().parse(value)
    if (!Bun.deepEquals(value, JSON.parse(data))) throw new ErrorClass('Resource values must be JSON compatible')

    return data
  } catch (error) {
    throw hedraError(error, ErrorClass)
  }
}

export class ResourceOperations<T> {
  /** Uses the supplied backend for one named resource collection. */
  constructor(
    readonly name: string,
    protected readonly backend: Backend,
  ) {}

  /** Validates generic JSON storage and server-owned resource identity. */
  private record(input: unknown, ErrorClass: typeof HedraError = OutputValidationError): DatabaseRecord {
    try {
      const stored: unknown = JSON.parse(jsonString(input, ErrorClass))
      const validated = RecordSchema.parse(stored)

      ResourceId.parse(validated.id)
      ResourceTimestamp.parse(validated.createdAt)
      ResourceTimestamp.parse(validated.updatedAt)

      return { ...validated, ...(stored as DatabaseRecord) }
    } catch (error) {
      throw hedraError(error, ErrorClass)
    }
  }

  /** Rejects externally supplied resource IDs. */
  private attributes(input: unknown): Record<string, unknown> {
    const attributes = parseInput(z.record(z.string(), z.unknown()), input)

    if (['id', 'createdAt', 'updatedAt'].some((key) => Object.hasOwn(input as object, key))) {
      throw new InputValidationError('Resource metadata is managed by the server')
    }

    return { ...attributes, ...(input as Record<string, unknown>) }
  }

  /** Creates a resource with a fresh ID. */
  async create(input: Attributes<T>): Promise<T> {
    try {
      const attributes = this.attributes(input)
      const id = crypto.randomUUID()
      const timestamp = new Date().toISOString()
      const stored = this.record(
        { ...attributes, id, createdAt: timestamp, updatedAt: timestamp },
        InputValidationError,
      )

      await this.backend.insert(this.name, stored)

      return stored as T
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Returns the addressed resource, or null when it is absent. */
  async get(id: string): Promise<T | null> {
    try {
      const key = parseInput(ResourceId, id)
      const rows = await this.backend.select(this.name, { id: key })

      if (!rows.length) return null
      const stored = this.record(rows[0])

      if (stored.id !== key) throw new HedraError('Resource ID cannot change')

      return stored as T
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Returns resources matching the supplied scalar criteria. */
  async list(filter: Filter<T> = {}): Promise<T[]> {
    try {
      if (Object.getOwnPropertySymbols(filter).length) throw new InputValidationError('Filter keys must be strings')
      parseInput(DatabaseFilter, filter)
      const entries = Object.entries(filter).map(([key, value]) => [key, parseInput(ScalarSchema, value)] as const)

      return (await this.backend.select(this.name, Object.fromEntries(entries))).map((row) => this.record(row) as T)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Shallowly changes one existing resource while preserving its ID. */
  async update(id: string, changes: Partial<Attributes<T>>): Promise<T | null> {
    try {
      const key = parseInput(ResourceId, id)
      const attributes = this.attributes(changes)
      const patch: Record<string, unknown> = JSON.parse(jsonString(attributes))
      const result = await this.backend.update(this.name, key, (current) => {
        const previous = this.record(current)

        if (previous.id !== key) throw new HedraError('Resource ID cannot change')

        return this.record({
          ...previous,
          ...patch,
          id: key,
          createdAt: previous.createdAt,
          updatedAt: new Date().toISOString(),
        })
      })

      return result === null ? null : (this.record(result) as T)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Replaces one existing resource while preserving its ID. */
  async replace(id: string, input: Attributes<T>): Promise<T | null> {
    try {
      const key = parseInput(ResourceId, id)
      const attributes = this.attributes(input)
      const result = await this.backend.update(this.name, key, (current) => {
        const previous = this.record(current)

        if (previous.id !== key) throw new HedraError('Resource ID cannot change')

        return this.record(
          { ...attributes, id: key, createdAt: previous.createdAt, updatedAt: new Date().toISOString() },
          InputValidationError,
        )
      })

      return result === null ? null : (this.record(result) as T)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }

  /** Removes one resource and reports whether it existed. */
  async delete(id: string): Promise<boolean> {
    try {
      const key = parseInput(ResourceId, id)

      return await this.backend.delete(this.name, key)
    } catch (error) {
      throw hedraError(error, HedraError)
    }
  }
}
