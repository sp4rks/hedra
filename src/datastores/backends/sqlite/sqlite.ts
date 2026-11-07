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
import { ConnectionError, hedraError, QueryError, TransactionError } from '#errors'

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
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new QueryError('Database values must be JSON compatible')

  return data
}

/** Validates a JSON record while preserving literal property names. */
function parseRecord(value: unknown): DatabaseRecord {
  const parsed = RecordSchema.parse(value)

  return { ...parsed, ...(value as DatabaseRecord) }
}

export class SqliteBackend implements Backend {
  private readonly db: Database
  private inTransaction = false

  /** Opens the database for generic collection storage. */
  constructor(path: string) {
    try {
      if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
      this.db = new Database(path, { create: true, strict: true })
    } catch (error) {
      throw hedraError(error, ConnectionError)
    }
  }

  /** Validates and prepares a table before using its quoted name. */
  private table(name: string): string {
    const table = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .parse(name)
    const quoted = `"${table}"`

    this.db.run(`CREATE TABLE IF NOT EXISTS ${quoted} (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`)

    return quoted
  }

  /** Inserts one JSON record without replacing an existing ID. */
  private insertRecord(table: string, record: DatabaseRecord): void {
    try {
      const data = jsonString(record)
      const parsed = parseRecord(JSON.parse(data))
      const name = this.table(table)

      this.db.run(`INSERT INTO ${name} (id, data) VALUES (?, ?)`, [parsed.id, data])
    } catch (error) {
      throw hedraError(error, QueryError)
    }
  }

  /** Reads matching JSON records in insertion order. */
  private selectRecords(table: string, filter: DatabaseFilter = {}): DatabaseRecord[] {
    try {
      if (Object.getOwnPropertySymbols(filter).length) throw new QueryError('Filter keys must be strings')
      FilterSchema.parse(filter)
      const entries = Object.entries(filter).map(([key, value]) => [key, ScalarSchema.parse(value)] as const)
      const data = jsonString(Object.fromEntries(entries))
      const name = this.table(table)
      const rows = this.db
        .query<{ data: string }, [string]>(`SELECT data FROM ${name} AS records WHERE ${matches} ORDER BY rowid`)
        .all(data)

      return rows.map((row) => parseRecord(JSON.parse(row.data)))
    } catch (error) {
      throw hedraError(error, QueryError)
    }
  }

  /** Atomically modifies one record without allowing its ID to change. */
  private updateRecord(table: string, id: string, modify: RecordModifier): DatabaseRecord | null {
    try {
      const key = z.string().parse(id)
      const name = this.table(table)

      const row = this.db.query<{ data: string }, [string]>(`SELECT data FROM ${name} WHERE id = ?`).get(key)

      if (!row) return null
      const current = parseRecord(JSON.parse(row.data))
      const updated = modify(current)
      const data = jsonString(updated)
      const parsed = parseRecord(JSON.parse(data))

      if (parsed.id !== key) throw new QueryError('Record ID cannot change')
      this.db.run(`UPDATE ${name} SET data = ? WHERE id = ?`, [data, key])

      return parsed
    } catch (error) {
      throw hedraError(error, QueryError)
    }
  }

  /** Deletes one record and reports whether it existed. */
  private deleteRecord(table: string, id: string): boolean {
    try {
      const key = z.string().parse(id)
      const name = this.table(table)

      return this.db.run(`DELETE FROM ${name} WHERE id = ?`, [key]).changes > 0
    } catch (error) {
      throw hedraError(error, QueryError)
    }
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
    try {
      return this.db.transaction(() => this.updateRecord(table, id, modify)).immediate()
    } catch (error) {
      throw hedraError(error, QueryError)
    }
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
    try {
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
    } catch (error) {
      throw hedraError(error, TransactionError)
    }
  }

  /** Closes the database after all stores have finished using it. */
  close(): void {
    try {
      this.db.close()
    } catch (error) {
      throw hedraError(error, ConnectionError)
    }
  }
}
