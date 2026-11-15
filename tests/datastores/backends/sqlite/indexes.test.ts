import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { QueryError, UniqueViolationError } from '#errors'
import { SqliteBackend } from '#hedra.ts'

test('SQLite indexes enforce unique fields while non-unique scope permits many resources', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.ensureIndexes('tenants', [{ field: 'tenantDomain', unique: true }])
    await backend.insert('tenants', { id: 'one', tenantDomain: 'acme.hedra.local' })
    await expect(backend.insert('tenants', { id: 'two', tenantDomain: 'acme.hedra.local' })).rejects.toBeInstanceOf(
      UniqueViolationError,
    )
    await backend.ensureIndexes('widgets', [{ field: 'environmentDomain', unique: false }])
    await backend.insert('widgets', { id: 'one', environmentDomain: 'dev.acme.hedra.local', value: true })
    await backend.insert('widgets', { id: 'two', environmentDomain: 'dev.acme.hedra.local', value: 1 })
    expect(await backend.select('widgets', { environmentDomain: 'dev.acme.hedra.local', value: true })).toHaveLength(1)
    expect(await backend.select('widgets', { environmentDomain: 'dev.acme.hedra.local', value: 1 })).toHaveLength(1)
    await backend.ensureIndexes('widgets', [{ field: 'environmentDomain', unique: false }])
  } finally {
    backend.close()
  }
})

test('SQLite compound uniqueness permits repeated components but rejects a repeated complete key', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.ensureIndexes('items', [{ fields: ['environmentDomain', 'sku'], unique: true }])
    await backend.insert('items', { id: 'one', environmentDomain: 'dev', sku: 'private-sku' })
    await backend.insert('items', { id: 'two', environmentDomain: 'prod', sku: 'private-sku' })
    await backend.insert('items', { id: 'three', environmentDomain: 'dev', sku: 'other' })
    await expect(
      backend.insert('items', { id: 'four', environmentDomain: 'dev', sku: 'private-sku' }),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    await expect(
      backend.update('items', 'three', (record) => ({ ...record, sku: 'private-sku' })),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    expect(await backend.select('items', { id: 'three' })).toMatchObject([{ sku: 'other' }])
    expect(await backend.select('items')).toHaveLength(3)
  } finally {
    backend.close()
  }
})

test.each(['single', 'compound'] as const)(
  'SQLite %s unique keys retain scalar types and permit null or missing parts',
  async (kind) => {
    const backend = new SqliteBackend(':memory:')

    try {
      await backend.ensureIndexes('items', [
        kind === 'single' ? { field: 'value', unique: true } : { fields: ['group', 'value'], unique: true },
      ])

      for (const [id, value] of [true, 1, '1', false, 0, '0', null, null].entries()) {
        await backend.insert('items', { id: String(id), group: 'same', value })
      }
      await backend.insert('items', { id: 'missing-one', group: 'same' })
      await backend.insert('items', { id: 'missing-two', group: 'same' })

      for (const value of [true, 1, '1', false, 0, '0']) {
        await expect(backend.insert('items', { id: 'duplicate', group: 'same', value })).rejects.toBeInstanceOf(
          UniqueViolationError,
        )
        expect(await backend.select('items', { value })).toHaveLength(1)
      }
      expect(await backend.select('items', { value: null })).toHaveLength(2)
      expect(await backend.select('items')).toHaveLength(10)
    } finally {
      backend.close()
    }
  },
)

test('failed unique preparation reports fields without values and rolls back the index batch', async () => {
  const backend = new SqliteBackend(':memory:')
  const original = [
    { id: 'one', existing: 'one', newField: 'one', group: 'same', secret: 'private-value' },
    { id: 'two', existing: 'two', newField: 'two', group: 'same', secret: 'private-value' },
  ]

  try {
    await backend.ensureIndexes('items', [{ field: 'existing', unique: true }])

    for (const record of original) await backend.insert('items', record)
    const error = await backend
      .ensureIndexes('items', [
        { field: 'newField', unique: true },
        { fields: ['group', 'secret'], unique: true },
      ])
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(QueryError)
    expect(error).toMatchObject({ detail: { table: 'items', fields: ['group', 'secret'] } })
    expect(JSON.stringify(error)).not.toContain('private-value')
    expect(await backend.select('items')).toEqual(original)
    await expect(backend.insert('items', { id: 'three', existing: 'one' })).rejects.toBeInstanceOf(UniqueViolationError)
    await backend.insert('items', { id: 'three', existing: 'three', newField: 'one' })
    expect(await backend.select('items')).toHaveLength(3)
  } finally {
    backend.close()
  }
})

test('SQLite upgrades legacy unique indexes atomically and preserves their enforcement after reopening', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hedra-index-upgrade-'))
  const path = join(directory, 'storage.sqlite')
  const legacy = new Database(path)

  legacy.run('CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)')
  legacy.run("CREATE UNIQUE INDEX hedra_5_items_value_unique ON items (json_extract(data, '$.value'))")
  legacy.close()
  let backend = new SqliteBackend(path)

  try {
    const rows = [
      { id: 'one', value: true, group: 'same', sku: 'same' },
      { id: 'two', value: 'other', group: 'same', sku: 'same' },
    ]

    for (const row of rows) await backend.insert('items', row)
    await expect(
      backend.ensureIndexes('items', [
        { field: 'value', unique: true },
        { fields: ['group', 'sku'], unique: true },
      ]),
    ).rejects.toBeInstanceOf(QueryError)
    await expect(backend.insert('items', { id: 'three', value: 1 })).rejects.toBeInstanceOf(UniqueViolationError)
    expect(await backend.select('items')).toEqual(rows)
    await backend.ensureIndexes('items', [{ field: 'value', unique: true }])
    await backend.insert('items', { id: 'three', value: 1 })
    backend.close()
    backend = new SqliteBackend(path)
    await backend.ensureIndexes('items', [{ field: 'value', unique: true }])
    await backend.ensureIndexes('items', [{ field: 'value', unique: true }])
    await expect(backend.insert('items', { id: 'four', value: 1 })).rejects.toBeInstanceOf(UniqueViolationError)
    expect(await backend.select('items', { value: true })).toMatchObject([{ id: 'one' }])
    expect(await backend.select('items', { value: 1 })).toMatchObject([{ id: 'three' }])
    expect(await backend.select('items')).toHaveLength(3)
  } finally {
    backend.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('distinct compound keys have independent constraints even when field names contain underscores', async () => {
  const backend = new SqliteBackend(':memory:')
  const indexes = [
    { fields: ['a_b', 'c'], unique: true as const },
    { fields: ['a', 'b_c'], unique: true as const },
  ]

  try {
    await backend.ensureIndexes('items', indexes)
    await backend.ensureIndexes('items', indexes)
    await backend.insert('items', { id: 'one', a_b: 'one', c: 'one', a: 'one', b_c: 'one' })
    await expect(
      backend.insert('items', { id: 'two', a_b: 'two', c: 'two', a: 'one', b_c: 'one' }),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    await expect(
      backend.insert('items', { id: 'two', a_b: 'one', c: 'one', a: 'two', b_c: 'two' }),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    await expect(
      backend.transaction((transaction) => {
        transaction.insert('items', { id: 'two', a_b: 'two', c: 'two', a: 'two', b_c: 'two' })
        transaction.insert('items', { id: 'three', a_b: 'three', c: 'three', a: 'one', b_c: 'one' })
      }),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    expect(await backend.select('items')).toHaveLength(1)
  } finally {
    backend.close()
  }
})

test.each([
  "CREATE INDEX hedra_compound_5_items_1_a_1_b_unique_typed ON items (json_extract(data, '$.a'), json_extract(data, '$.b'))",
  "CREATE UNIQUE INDEX hedra_compound_5_items_1_a_1_b_unique_typed ON items (json_extract(data, '$.other'))",
  "CREATE INDEX HEDRA_COMPOUND_5_ITEMS_1_A_1_B_UNIQUE_TYPED ON items (json_extract(data, '$.a'))",
])('SQLite rejects an occupied compound index name with a different definition %#', async (definition) => {
  const directory = mkdtempSync(join(tmpdir(), 'hedra-index-collision-'))
  const path = join(directory, 'storage.sqlite')
  const existing = new Database(path)

  existing.run('CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)')
  existing.run(definition)
  existing.close()
  const backend = new SqliteBackend(path)

  try {
    const original = { id: 'one', a: 'private-value', b: 'same' }

    await backend.insert('items', original)
    const error = await backend
      .ensureIndexes('items', [{ fields: ['a', 'b'], unique: true }])
      .catch((cause: unknown) => cause)

    expect(error).toBeInstanceOf(QueryError)
    expect(error).toMatchObject({ detail: { table: 'items', fields: ['a', 'b'] } })
    expect(JSON.stringify(error)).not.toContain('private-value')
    expect(await backend.select('items')).toEqual([original])
  } finally {
    backend.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test.each([
  "CREATE INDEX hedra_5_items_value_unique_typed ON items (json_extract(data, '$.value'))",
  "CREATE UNIQUE INDEX hedra_5_items_value_unique_typed ON items (json_extract(data, '$.other'))",
])(
  'SQLite preserves the legacy constraint when its replacement name has a different definition %#',
  async (definition) => {
    const directory = mkdtempSync(join(tmpdir(), 'hedra-legacy-index-collision-'))
    const path = join(directory, 'storage.sqlite')
    const existing = new Database(path)

    existing.run('CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)')
    existing.run("CREATE UNIQUE INDEX hedra_5_items_value_unique ON items (json_extract(data, '$.value'))")
    existing.run(definition)
    existing.close()
    const backend = new SqliteBackend(path)

    try {
      await backend.insert('items', { id: 'one', value: 'private-value' })
      const error = await backend
        .ensureIndexes('items', [{ field: 'value', unique: true }])
        .catch((cause: unknown) => cause)

      expect(error).toBeInstanceOf(QueryError)
      expect(error).toMatchObject({ detail: { table: 'items', fields: ['value'] } })
      expect(JSON.stringify(error)).not.toContain('private-value')
      await expect(backend.insert('items', { id: 'two', value: 'private-value' })).rejects.toBeInstanceOf(
        UniqueViolationError,
      )
      expect(await backend.select('items')).toHaveLength(1)
    } finally {
      backend.close()
      rmSync(directory, { recursive: true, force: true })
    }
  },
)
