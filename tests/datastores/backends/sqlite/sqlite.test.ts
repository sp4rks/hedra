import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { HedraError } from '#errors'
import { SqliteBackend } from '#hedra.ts'

test('SqliteBackend stores arbitrary JSON records by table', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('cars', { id: 'one', make: 'Toyota', nested: { year: 2024 } })
    await backend.insert('tenants', { id: 'one', name: 'Acme', flags: [true, null] })
    expect(await backend.select('cars')).toEqual([{ id: 'one', make: 'Toyota', nested: { year: 2024 } }])
    expect(await backend.select('tenants')).toEqual([{ id: 'one', name: 'Acme', flags: [true, null] }])
  } finally {
    backend.close()
  }
})

test('SqliteBackend applies an update modifier atomically', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('cars', { id: 'one', count: 1 })
    expect(await backend.update('cars', 'one', (record) => ({ ...record, count: 2 }))).toEqual({ id: 'one', count: 2 })
    await expect(
      backend.update('cars', 'one', () => {
        throw new Error('invalid')
      }),
    ).rejects.toThrow('invalid')
    await expect(backend.update('cars', 'one', (record) => ({ ...record, id: 'changed' }))).rejects.toThrow()
    await expect(
      backend.update('cars', 'one', (record) => {
        record.id = 'changed'

        return record
      }),
    ).rejects.toThrow()
    await expect(
      backend.update('cars', 'one', (record) => ({ ...record, count: undefined }) as never),
    ).rejects.toThrow()
    let called = false

    expect(
      await backend.update('cars', 'missing', (record) => {
        called = true

        return record
      }),
    ).toBeNull()
    expect(called).toBe(false)
    expect(await backend.select('cars')).toEqual([{ id: 'one', count: 2 }])
  } finally {
    backend.close()
  }
})

test('SqliteBackend rejects duplicate primary keys without replacing data', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('items', { id: 'one', name: 'Original' })
    let error: unknown

    try {
      await backend.insert('items', { id: 'one', name: 'Replacement' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'UniqueViolationError', status: 409 })
    expect(error).toBeInstanceOf(HedraError)
    expect(await backend.select('items')).toEqual([{ id: 'one', name: 'Original' }])
  } finally {
    backend.close()
  }
})

test('SqliteBackend keeps a mutable input record key consistent with its stored ID', async () => {
  const backend = new SqliteBackend(':memory:')
  let reads = 0
  const input = {
    get id() {
      reads += 1

      return reads <= 3 ? 'serialized-id' : 'later-id'
    },
    name: 'Example',
  }

  try {
    const accepted = await backend.insert('items', input).then(
      () => true,
      () => false,
    )
    const selected = await backend.select('items')

    if (!accepted) {
      expect(selected).toEqual([])

      return
    }
    expect(selected).toHaveLength(1)
    const stored = selected[0]

    if (!stored) throw new Error('Expected one stored record')
    expect(await backend.delete('items', stored.id)).toBe(true)
    expect(await backend.select('items')).toEqual([])
  } finally {
    backend.close()
  }
})

test('SqliteBackend cannot bypass immutable IDs with a mutable modifier result', async () => {
  const backend = new SqliteBackend(':memory:')
  let reads = 0
  const modified = {
    get id() {
      reads += 1

      return reads <= 3 ? 'changed' : 'one'
    },
    name: 'Changed',
  }

  try {
    const original = { id: 'one', name: 'Original' }

    await backend.insert('items', original)
    const outcome = await backend
      .update('items', 'one', () => modified)
      .then(
        (record) => ({ accepted: true, record }),
        () => ({ accepted: false, record: null }),
      )
    const selected = await backend.select('items')

    expect(selected).toHaveLength(1)
    expect(selected[0]?.id).toBe('one')
    if (outcome.accepted) {
      if (!outcome.record) throw new Error('Expected an updated record')
      expect(selected).toEqual([outcome.record])
    } else expect(selected).toEqual([original])
  } finally {
    backend.close()
  }
})

test('SqliteBackend treats IDs and filter values as literal data', async () => {
  const backend = new SqliteBackend(':memory:')
  const literal = "' OR 1=1 --"

  try {
    await backend.insert('items', { id: literal, 'a.b': literal, value: 1 })
    await backend.insert('items', { id: 'string', 'a.b': literal, value: '1' })
    await backend.insert('items', { id: 'boolean', value: true })
    await backend.insert('items', { id: 'null', value: null })
    await backend.insert('items', { id: 'missing' })
    const special = JSON.parse('{"id":"special","__proto__":"literal"}')

    await backend.insert('items', special)
    expect(await backend.select('items', { id: literal, 'a.b': literal, value: 1 })).toEqual([
      { id: literal, 'a.b': literal, value: 1 },
    ])
    expect(await backend.select('items', { value: '1' })).toEqual([{ id: 'string', 'a.b': literal, value: '1' }])
    expect(await backend.select('items', { value: true })).toEqual([{ id: 'boolean', value: true }])
    expect(await backend.select('items', { value: null })).toEqual([{ id: 'null', value: null }])
    expect(await backend.select('items', JSON.parse('{"__proto__":"literal"}'))).toEqual([special])
    expect(await backend.delete('items', literal)).toBe(true)
    expect(await backend.select('items', { id: literal })).toEqual([])
  } finally {
    backend.close()
  }
})

test('SqliteBackend rejects non-scalar criteria under literal property names', async () => {
  const backend = new SqliteBackend(':memory:')
  const record = JSON.parse('{"id":"special","__proto__":"literal"}')

  try {
    await backend.insert('items', record)
    await expect(backend.select('items', JSON.parse('{"__proto__":{"nested":true}}'))).rejects.toThrow()
    expect(await backend.select('items', JSON.parse('{"__proto__":"literal"}'))).toEqual([record])
  } finally {
    backend.close()
  }
})

test('SqliteBackend queries only the validated scalar snapshot of a changing filter', async () => {
  const backend = new SqliteBackend(':memory:')
  const record = { id: 'one', name: 'Example' }
  let reads = 0
  const filter = {
    get name() {
      reads += 1

      return reads === 1 ? 'Example' : { nested: true }
    },
  }

  try {
    await backend.insert('items', record)
    const outcome = await backend.select('items', filter as never).then(
      (records) => ({ accepted: true, records }),
      () => ({ accepted: false, records: [] }),
    )

    if (outcome.accepted) expect(outcome.records).toEqual([record])
    else expect(await backend.select('items')).toEqual([record])
  } finally {
    backend.close()
  }
})

test('SqliteBackend rejects invalid table identifiers without affecting other tables', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('valid-name', { id: 'one' })

    for (const table of ['', 'A', 'name;DROP TABLE valid', 'bad"name', '../x', 7, null]) {
      await expect(backend.insert(table as never, { id: 'x' })).rejects.toThrow()
      await expect(backend.select(table as never)).rejects.toThrow()
      await expect(backend.update(table as never, 'one', (record) => record)).rejects.toThrow()
      await expect(backend.delete(table as never, 'one')).rejects.toThrow()
    }
    expect(await backend.select('valid-name')).toEqual([{ id: 'one' }])
  } finally {
    backend.close()
  }
})

test('SqliteBackend rejects non-JSON records without writing', async () => {
  const backend = new SqliteBackend(':memory:')
  const cycle: { self?: unknown } = {}

  cycle.self = cycle

  try {
    await backend.insert('items', { id: 'one', name: 'Original' })

    for (const value of [undefined, Infinity, 1n, new Date(), new Map(), cycle, { [Symbol('key')]: 'value' }]) {
      await expect(backend.insert('items', { id: 'other', value } as never)).rejects.toThrow()
      await expect(backend.update('items', 'one', (record) => ({ ...record, value }) as never)).rejects.toThrow()
      expect(await backend.select('items')).toEqual([{ id: 'one', name: 'Original' }])
    }
  } finally {
    backend.close()
  }
})

test('SqliteBackend holds its transaction while the modifier runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-backend-'))
  const path = join(dir, 'shared.sqlite')
  const first = new SqliteBackend(path)
  const second = new SqliteBackend(path)
  let competing: Promise<boolean> | undefined

  try {
    await first.insert('items', { id: 'one', count: 0 })
    await first.update('items', 'one', (record) => {
      competing = second
        .update('items', 'one', (other) => ({ ...other, count: Number(other.count) + 10 }))
        .then(
          () => true,
          () => false,
        )

      return { ...record, count: Number(record.count) + 1 }
    })
    const committed = await competing

    expect(await first.select('items')).toEqual([{ id: 'one', count: committed ? 11 : 1 }])
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SqliteBackend persists records across reopening a nested path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-backend-'))
  const path = join(dir, 'nested', 'db.sqlite')
  let backend: SqliteBackend | undefined

  try {
    backend = new SqliteBackend(path)
    await backend.insert('items', { id: 'non-uuid', name: 'Saved' })
    backend.close()
    backend = new SqliteBackend(path)
    expect(await backend.select('items')).toEqual([{ id: 'non-uuid', name: 'Saved' }])
  } finally {
    backend?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SqliteBackend gives in-memory instances independent storage', async () => {
  const first = new SqliteBackend(':memory:')
  const second = new SqliteBackend(':memory:')

  try {
    await first.insert('items', { id: 'one' })
    expect(await second.select('items')).toEqual([])
  } finally {
    first.close()
    second.close()
  }
})

test('SqliteBackend rejects an unusable path and access after close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-backend-'))

  try {
    expect(() => new SqliteBackend(dir)).toThrow()
    const backend = new SqliteBackend(':memory:')

    backend.close()
    await expect(backend.insert('items', { id: 'one' })).rejects.toThrow()
    await expect(backend.select('items')).rejects.toThrow()
    await expect(backend.update('items', 'one', (record) => record)).rejects.toThrow()
    await expect(backend.delete('items', 'one')).rejects.toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SqliteBackend creates the requested physical tables', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-backend-'))
  const path = join(dir, 'db.sqlite')
  const backend = new SqliteBackend(path)

  try {
    await backend.insert('cars-test', { id: 'one', make: 'Toyota' })
    const observer = new Database(path, { readonly: true })

    try {
      expect(observer.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual(
        [{ name: 'cars-test' }],
      )
      expect(observer.query<{ name: string }, []>("SELECT name FROM pragma_table_info('cars-test')").all()).toEqual([
        { name: 'id' },
        { name: 'data' },
      ])
    } finally {
      observer.close()
    }
  } finally {
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
