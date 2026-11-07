import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

import type {
  Backend,
  BackendTransaction,
  DatabaseFilter,
  DatabaseRecord,
  RecordModifier,
} from '#datastores/backend.ts'
import {
  DatabaseFilter as FilterSchema,
  DatabaseRecord as RecordSchema,
  DatabaseScalar as ScalarSchema,
} from '#datastores/backend.ts'
import { QueryError, TransactionError } from '#errors'

const matches = `NOT EXISTS (
  SELECT 1 FROM json_each(?) AS criterion WHERE NOT EXISTS (
    SELECT 1 FROM json_each(records.data) AS field
    WHERE field.key = criterion.key AND (
      (field.type IN ('integer', 'real') AND criterion.type IN ('integer', 'real') AND field.atom = criterion.atom)
      OR (field.type = criterion.type AND (field.type = 'null' OR field.atom = criterion.atom))
    )
  )
)`

/** Serializes a value only if JSON preserves it without loss. */
function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new QueryError('Database values must be JSON compatible')
  const json = z.json().safeParse(value)

  if (!json.success) throw new QueryError('Database values must be JSON compatible', json.error.issues)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new QueryError('Database values must be JSON compatible')

  return data
}

/** Validates a JSON record while preserving literal property names. */
function parseRecord(value: unknown): DatabaseRecord {
  const parsed = RecordSchema.safeParse(value)

  if (!parsed.success) throw new QueryError('Invalid database record', parsed.error.issues)

  return { ...parsed.data, ...(value as DatabaseRecord) }
}

export class SqliteBackend implements Backend {
  private readonly db: Database
  private inTransaction = false

  /** Opens the database for generic collection storage. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new Database(path, { create: true, strict: true })
  }

  /** Validates and prepares a table before using its quoted name. */
  private table(name: string): string {
    const table = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .safeParse(name)

    if (!table.success) throw new QueryError('Invalid table name', table.error.issues)
    const quoted = `"${table.data}"`

    this.db.run(`CREATE TABLE IF NOT EXISTS ${quoted} (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`)

    return quoted
  }

  /** Inserts one JSON record without replacing an existing ID. */
  private insertRecord(table: string, record: DatabaseRecord): void {
    const data = jsonString(record)
    const parsed = parseRecord(JSON.parse(data))
    const name = this.table(table)

    this.db.run(`INSERT INTO ${name} (id, data) VALUES (?, ?)`, [parsed.id, data])
  }

  /** Reads matching JSON records in insertion order. */
  private selectRecords(table: string, filter: DatabaseFilter = {}): DatabaseRecord[] {
    const parsedFilter = FilterSchema.safeParse(filter)

    if (!parsedFilter.success) throw new QueryError('Invalid database filter', parsedFilter.error.issues)
    if (Object.getOwnPropertySymbols(filter).length) throw new QueryError('Filter keys must be strings')
    const entries = Object.entries(filter).map(([key, value]) => {
      const parsed = ScalarSchema.safeParse(value)

      if (!parsed.success) throw new QueryError('Invalid database filter', parsed.error.issues)

      return [key, parsed.data] as const
    })
    const data = jsonString(Object.fromEntries(entries))
    const name = this.table(table)
    const rows = this.db
      .query<{ data: string }, [string]>(`SELECT data FROM ${name} AS records WHERE ${matches} ORDER BY rowid`)
      .all(data)

    return rows.map((row) => parseRecord(JSON.parse(row.data)))
  }

  /** Atomically modifies one record without allowing its ID to change. */
  private updateRecord(table: string, id: string, modify: RecordModifier): DatabaseRecord | null {
    const parsed = z.string().safeParse(id)

    if (!parsed.success) throw new QueryError('Invalid record ID', parsed.error.issues)
    const key = parsed.data
    const name = this.table(table)

    const row = this.db.query<{ data: string }, [string]>(`SELECT data FROM ${name} WHERE id = ?`).get(key)

    if (!row) return null
    const current = parseRecord(JSON.parse(row.data))
    const updated = modify(current)
    const data = jsonString(updated)
    const updatedRecord = parseRecord(JSON.parse(data))

    if (updatedRecord.id !== key) throw new QueryError('Record ID cannot change')
    this.db.run(`UPDATE ${name} SET data = ? WHERE id = ?`, [data, key])

    return updatedRecord
  }

  /** Deletes one record and reports whether it existed. */
  private deleteRecord(table: string, id: string): boolean {
    const parsed = z.string().safeParse(id)

    if (!parsed.success) throw new QueryError('Invalid record ID', parsed.error.issues)
    const key = parsed.data
    const name = this.table(table)

    return this.db.run(`DELETE FROM ${name} WHERE id = ?`, [key]).changes > 0
  }

  /** Inserts a record without replacing an existing key. */
  async insert(table: string, record: DatabaseRecord): Promise<void> {
    this.insertRecord(table, record)
  }

  /** Selects matching records. */
  async select(table: string, filter: DatabaseFilter = {}): Promise<DatabaseRecord[]> {
    return this.selectRecords(table, filter)
  }

  /** Atomically modifies one record. */
  async update(table: string, id: string, modify: RecordModifier): Promise<DatabaseRecord | null> {
    return this.db.transaction(() => this.updateRecord(table, id, modify)).immediate()
  }

  /** Deletes one record. */
  async delete(table: string, id: string): Promise<boolean> {
    return this.deleteRecord(table, id)
  }

  /**
   * Runs synchronous record operations atomically in one immediate transaction.
   * The backend API returns a promise, but callbacks and session methods must stay
   * synchronous. SQLite commits on success and rolls back on failure; saved sessions
   * expire when the transaction finishes.
   */
  async transaction<T>(work: (transaction: BackendTransaction) => T): Promise<T> {
    if (this.inTransaction) throw new TransactionError('Nested transactions are not supported')
    this.inTransaction = true
    let sessionActive = true
    /** Rejects session operations after the transaction finishes. */
    const assertSessionActive = () => {
      if (!sessionActive) throw new TransactionError('Transaction is no longer active')
    }
    const session: BackendTransaction = {
      insert: (table, record) => {
        assertSessionActive()
        this.insertRecord(table, record)
      },
      select: (table, filter) => {
        assertSessionActive()

        return this.selectRecords(table, filter)
      },
      update: (table, id, modify) => {
        assertSessionActive()

        return this.updateRecord(table, id, modify)
      },
      delete: (table, id) => {
        assertSessionActive()

        return this.deleteRecord(table, id)
      },
    }

    try {
      return this.db
        .transaction(() => {
          const result = work(session)

          if (
            result !== null &&
            (typeof result === 'object' || typeof result === 'function') &&
            typeof Reflect.get(result, 'then') === 'function'
          ) {
            // Consume a later rejection while throwing now to roll back the transaction.
            Promise.resolve(result).catch(() => {})
            throw new TransactionError('Transaction callbacks must be synchronous')
          }

          return result
        })
        .immediate()
    } finally {
      sessionActive = false
      this.inTransaction = false
    }
  }

  /** Closes the database after all stores have finished using it. */
  close(): void {
    this.db.close()
  }
}
