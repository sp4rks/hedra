import { z } from 'zod'

export const DatabaseRecord = z.object({ id: z.string() }).catchall(z.json())

export type DatabaseRecord = z.infer<typeof DatabaseRecord>

export const DatabaseScalar = z.union([z.string(), z.number(), z.boolean(), z.null()])

export type DatabaseScalar = z.infer<typeof DatabaseScalar>

export const DatabaseFilter = z.record(z.string(), DatabaseScalar)

export type DatabaseFilter = z.infer<typeof DatabaseFilter>

export const DatabaseIndex = z.strictObject({
  field: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  unique: z.boolean(),
})

export type DatabaseIndex = z.infer<typeof DatabaseIndex>

export type RecordModifier = (record: DatabaseRecord) => DatabaseRecord

export interface BackendTransaction {
  insert(table: string, record: DatabaseRecord): void
  select(table: string, filter?: DatabaseFilter): DatabaseRecord[]
  update(table: string, id: string, modify: RecordModifier): DatabaseRecord | null
  delete(table: string, id: string): boolean
}

export interface Backend {
  /** Prepares generic single-field indexes before collection operations. */
  ensureIndexes(table: string, indexes: readonly DatabaseIndex[]): Promise<void>
  /** Inserts a record without replacing an existing ID. */
  insert(table: string, record: DatabaseRecord): Promise<void>
  /** Selects matching records in insertion order. */
  select(table: string, filter?: DatabaseFilter): Promise<DatabaseRecord[]>
  /** Atomically modifies one record, or returns null when it is absent. */
  update(table: string, id: string, modify: RecordModifier): Promise<DatabaseRecord | null>
  /** Deletes one record, returning whether it existed. */
  delete(table: string, id: string): Promise<boolean>
  /** Runs synchronous operations in one atomic transaction. */
  transaction<T>(work: (transaction: BackendTransaction) => T): Promise<T>
}
