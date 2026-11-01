import type { Database } from 'bun:sqlite'
import { z } from 'zod'

import { deleteRecords, insertRecord, readRecords, replaceRecord } from '#datastores/sqlite.ts'

const connections = new WeakMap<object, Database>()
const scalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const filterSchema = z.record(z.string(), scalar)

type Scalar = z.infer<typeof scalar>
type Filter<S extends z.ZodObject> = Partial<{
  [K in keyof z.output<S> as Exclude<z.output<S>[K], undefined> extends Scalar ? K : never]: z.output<S>[K]
}>

/** Serializes a value only when JSON preserves it without loss. */
function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new Error('Collection values must be JSON compatible')
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new Error('Collection values must be JSON compatible')

  return data
}

/** Checks whether a collection has already been attached to an app. */
export function isAttached(collection: object): boolean {
  return connections.has(collection)
}

/** Attaches a collection to its app's shared database. */
export function attachCollection(collection: object, db: Database): void {
  connections.set(collection, db)
}

export class Collection<S extends z.ZodObject> {
  readonly name: string
  readonly model: S

  /** Defines a named collection governed by a Zod object model. */
  constructor(name: string, model: S) {
    this.name = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .parse(name)
    if (!(model instanceof z.ZodObject)) throw new TypeError('Collection model must be a Zod object')
    this.model = model
  }

  /** Returns the connection established by registration. */
  private database(): Database {
    const db = connections.get(this)

    if (!db) throw new Error('Collection must be registered before use')

    return db
  }

  /** Validates and serializes an equality filter. */
  private filter(filter: Filter<S>, required = false): string {
    filterSchema.parse(filter)
    if (Object.getOwnPropertySymbols(filter).length) throw new Error('Collection filter keys must be strings')
    const entries = Object.entries(filter)

    if (required && entries.length === 0) throw new Error('A nonempty collection filter is required')

    for (const [key, value] of entries) {
      if (!Object.hasOwn(this.model.shape, key)) throw new Error(`Invalid collection filter field: ${key}`)
      const field = this.model.shape[key]

      if (!field?.safeParse(scalar.parse(value)).success) {
        throw new Error(`Invalid collection filter field: ${key}`)
      }
    }

    return JSON.stringify(Object.fromEntries(entries))
  }

  /** Validates a model and serializes its JSON-compatible value. */
  private encode(input: unknown): { record: z.output<S>; data: string } {
    const record = this.model.parse(input)
    const data = jsonString(record)
    const stored: unknown = JSON.parse(data)

    if (!Bun.deepEquals(stored, this.model.parse(JSON.parse(data)))) {
      throw new Error('Collection model must produce stable JSON records')
    }

    return { record, data }
  }

  /** Validates and inserts one record. */
  post(input: z.input<S>): z.output<S> {
    const db = this.database()
    const { record, data } = this.encode(input)

    insertRecord(db, this.name, data)

    return record
  }

  /** Reads matching records in insertion order. */
  get(filter: Filter<S> = {}): z.output<S>[] {
    const db = this.database()

    return readRecords(db, this.name, this.filter(filter)).map((row) => this.encode(JSON.parse(row.data)).record)
  }

  /** Replaces every matching record with a full model. */
  put(filter: Filter<S>, input: z.input<S>): number {
    const db = this.database()
    const criteria = this.filter(filter, true)

    return db
      .transaction(() => {
        const rows = readRecords(db, this.name, criteria)
        const { data } = this.encode(input)

        for (const row of rows) replaceRecord(db, this.name, row.id, data)

        return rows.length
      })
      .immediate()
  }

  /** Applies shallow changes to every matching record. */
  patch(filter: Filter<S>, changes: Partial<z.input<S>>): number {
    const db = this.database()
    const criteria = this.filter(filter, true)

    z.record(z.string(), z.unknown()).parse(changes)
    const patch: Record<string, unknown> = JSON.parse(jsonString(changes))

    return db
      .transaction(() => {
        const rows = readRecords(db, this.name, criteria)
        const updates = rows.map((row) => {
          const record = this.encode(JSON.parse(row.data)).record

          return this.encode({ ...record, ...patch }).data
        })

        for (const [index, row] of rows.entries()) replaceRecord(db, this.name, row.id, updates[index] as string)

        return rows.length
      })
      .immediate()
  }

  /** Deletes all matching records. */
  delete(filter: Filter<S>): number {
    const db = this.database()

    return deleteRecords(db, this.name, this.filter(filter, true))
  }
}
