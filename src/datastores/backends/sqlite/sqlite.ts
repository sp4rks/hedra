import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'

import type {
  Backend,
  BackendTransaction,
  DatabaseFilter,
  DatabaseIndex,
  DatabaseRecord,
  RecordModifier,
} from '#datastores/backend.ts'
import {
  DatabaseFilter as FilterSchema,
  DatabaseIndex as IndexSchema,
  DatabaseRecord as RecordSchema,
  DatabaseScalar as ScalarSchema,
} from '#datastores/backend.ts'
import { QueryError, TransactionError, UniqueViolationError } from '#errors'

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
  private readonly indexes = new Map<string, Set<string>>()

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

    try {
      this.db.run(`INSERT INTO ${name} (id, data) VALUES (?, ?)`, [parsed.id, data])
    } catch (error) {
      this.failure(error)
    }
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
    const indexed = entries.filter(([key]) => this.indexes.get(table)?.has(key))
    const conditions = indexed.map(([key]) => `json_extract(records.data, '$.${key}') IS ?`)
    const values = indexed.map(([, value]) => (typeof value === 'boolean' ? Number(value) : value))
    const where = [...conditions, matches].join(' AND ')
    const rows = this.db
      .query<{ data: string }, (string | number | null)[]>(
        `SELECT data FROM ${name} AS records WHERE ${where} ORDER BY rowid`,
      )
      .all(...values, data)

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
    try {
      this.db.run(`UPDATE ${name} SET data = ? WHERE id = ?`, [data, key])
    } catch (error) {
      this.failure(error)
    }

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

  /** Maps database-enforced uniqueness without exposing backend-specific errors. */
  private failure(error: unknown, constraint?: { table: string; fields: string[] }): never {
    if (
      error instanceof Error &&
      'code' in error &&
      ['SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(String(error.code))
    ) {
      if (constraint) throw new QueryError('Cannot prepare unique index', constraint)
      throw new UniqueViolationError()
    }

    throw error
  }

  /** Creates validated JSON-expression indexes and enables the matching select path. */
  async ensureIndexes(table: string, indexes: readonly DatabaseIndex[]): Promise<void> {
    const parsed = z.array(IndexSchema).safeParse(indexes)

    if (!parsed.success) throw new QueryError('Invalid database indexes', parsed.error.issues)
    const name = this.table(table)

    this.db
      .transaction(() => {
        for (const index of parsed.data) {
          const fields = 'field' in index ? [index.field] : index.fields
          const identifier =
            'field' in index
              ? `hedra_${table.length}_${table}_${index.field}_${index.unique ? 'unique' : 'index'}`
              : `hedra_compound_${table.length}_${table}_${fields.map((field) => `${field.length}_${field}`).join('_')}_unique`
          // Keep the value first so scalar filters can use the index; numeric JSON types compare together.
          const expressions = fields
            .flatMap((field) => [
              `json_extract(data, '$.${field}')`,
              ...(index.unique
                ? [
                    `CASE json_type(data, '$.${field}') WHEN 'integer' THEN 'real' ELSE json_type(data, '$.${field}') END`,
                  ]
                : []),
            ])
            .join(', ')

          const indexName = `${identifier}${index.unique ? '_typed' : ''}`
          const definition = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX "${indexName}" ON ${name} (${expressions})`

          try {
            const existing = this.db
              .query<{ sql: string }, [string]>(
                "SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ? COLLATE NOCASE",
              )
              .get(indexName)

            if (existing && existing.sql !== definition)
              throw new QueryError('Existing index definition does not match', { table, fields })
            if (!existing) this.db.run(definition)
            // Replacing the legacy untyped constraint is part of the same installation transaction.
            if ('field' in index && index.unique) this.db.run(`DROP INDEX IF EXISTS "${identifier}"`)
          } catch (error) {
            this.failure(error, { table, fields })
          }
        }
      })
      .immediate()
    const fields = this.indexes.get(table) ?? new Set<string>()

    for (const index of parsed.data) {
      if ('field' in index) fields.add(index.field)
    }

    this.indexes.set(table, fields)
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
