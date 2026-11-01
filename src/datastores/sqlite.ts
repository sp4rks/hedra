import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const matches = `collection = ? AND NOT EXISTS (
  SELECT 1 FROM json_each(?) AS criterion WHERE NOT EXISTS (
    SELECT 1 FROM json_each(records.data) AS field
    WHERE field.key = criterion.key AND (
      (field.type IN ('integer', 'real') AND criterion.type IN ('integer', 'real') AND field.atom = criterion.atom)
      OR (field.type = criterion.type AND (field.type = 'null' OR field.atom = criterion.atom))
    )
  )
)`

/** Opens the shared database and creates collection storage when needed. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path, { create: true, strict: true })
  try {
    db.run('CREATE TABLE IF NOT EXISTS hedra_records (collection TEXT NOT NULL, data TEXT NOT NULL)')
    db.run('CREATE INDEX IF NOT EXISTS hedra_records_collection ON hedra_records (collection)')
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Inserts a serialized record into a collection. */
export function insertRecord(db: Database, name: string, data: string): void {
  db.run('INSERT INTO hedra_records (collection, data) VALUES (?, ?)', [name, data])
}

/** Reads serialized records in insertion order. */
export function readRecords(db: Database, name: string, filter: string): { id: number; data: string }[] {
  return db
    .query<{ id: number; data: string }, [string, string]>(`
    SELECT rowid AS id, data FROM hedra_records AS records
    WHERE ${matches} ORDER BY rowid
  `)
    .all(name, filter)
}

/** Replaces one selected record. */
export function replaceRecord(db: Database, name: string, id: number, data: string): void {
  db.run('UPDATE hedra_records SET data = ? WHERE collection = ? AND rowid = ?', [data, name, id])
}

/** Deletes all matching records in one statement. */
export function deleteRecords(db: Database, name: string, filter: string): number {
  return db.run(`DELETE FROM hedra_records AS records WHERE ${matches}`, [name, filter]).changes
}
