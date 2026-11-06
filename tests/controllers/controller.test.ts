import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { Controller, Resource, SqliteBackend } from '#hedra.ts'

const Car = Resource.extend({ make: z.string().trim().min(1), year: z.number().int().default(2024) })

test('create returns a normalized resource with a fresh UUID', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const first = await cars.create({ make: ' Toyota ' })
    const second = await cars.create({ make: 'Honda', year: 2025 })

    expect(Resource.parse(first)).toEqual({ id: first.id })
    expect(Resource.parse(second)).toEqual({ id: second.id })
    expect(first.id).not.toBe(second.id)
    expect(first).toEqual({ id: first.id, make: 'Toyota', year: 2024 })
    expect(second).toEqual({ id: second.id, make: 'Honda', year: 2025 })
    expect(await cars.get(first.id)).toEqual(first)
    expect(await cars.list()).toEqual([first, second])
  } finally {
    backend.close()
  }
})

test('create rejects a supplied ID without inserting a resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    // @ts-expect-error The controller owns the resource ID.
    await expect(cars.create({ id: crypto.randomUUID(), make: 'Toyota' })).rejects.toThrow()
    await expect(cars.create({ id: undefined, make: 'Toyota' })).rejects.toThrow()
    expect(await cars.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('create rejects invalid resource attributes without writing', async () => {
  const backend = new SqliteBackend(':memory:')
  const Range = Resource.extend({ min: z.number(), max: z.number() }).refine((value) => value.min <= value.max)
  const ranges = new Controller('ranges', Range, backend)

  try {
    await expect(ranges.create({ min: 2 } as never)).rejects.toThrow()
    await expect(ranges.create({ min: '2', max: 3 } as never)).rejects.toThrow()
    await expect(ranges.create({ min: 3, max: 2 })).rejects.toThrow()
    expect(await ranges.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('create prevents model transforms from replacing the generated ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const id = crypto.randomUUID()
  const Model = Resource.extend({ name: z.string() }).superRefine((value) => {
    value.id = id
  })
  const controller = new Controller('items', Model, backend)

  try {
    await expect(controller.create({ name: 'Item' })).rejects.toThrow('ID')
    expect(await controller.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('list rejects model transforms that replace stored IDs', async () => {
  const backend = new SqliteBackend(':memory:')
  const fixed = crypto.randomUUID()
  const original = crypto.randomUUID()
  const Model = Resource.extend({ name: z.string() }).superRefine((value) => {
    value.id = fixed
  })
  const controller = new Controller('items', Model, backend)

  try {
    await backend.insert('items', { id: original, name: 'Item' })
    await expect(controller.list()).rejects.toThrow('ID')
    await expect(controller.get(original)).rejects.toThrow('ID')
  } finally {
    backend.close()
  }
})

test('update changes only the addressed resource and preserves its ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({
    name: z.string(),
    engine: z.object({ fuel: z.string(), cylinders: z.number().optional() }),
    tags: z.array(z.string()),
    note: z.string().optional(),
  })
  const controller = new Controller('items', Model, backend)

  try {
    const first = await controller.create({
      name: 'One',
      engine: { fuel: 'petrol', cylinders: 4 },
      tags: ['old'],
      note: 'keep',
    })
    const second = await controller.create({ name: 'Two', engine: { fuel: 'diesel' }, tags: [] })
    const expected = { ...first, engine: { fuel: 'electric' }, tags: ['new'] }

    expect(await controller.update(first.id, { engine: { fuel: 'electric' }, tags: ['new'] })).toEqual(expected)
    expect(await controller.update(first.id, {})).toEqual(expected)
    expect(await controller.get(first.id)).toEqual(expected)
    expect(await controller.get(second.id)).toEqual(second)
  } finally {
    backend.close()
  }
})

test('replace uses the complete model while preserving the addressed ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({ name: z.string(), status: z.string().default('new'), note: z.string().optional() })
  const controller = new Controller('items', Model, backend)

  try {
    const first = await controller.create({ name: 'One', status: 'old', note: 'remove' })
    const second = await controller.create({ name: 'Two' })
    const expected = { id: first.id, name: 'Replacement', status: 'new' }

    expect(await controller.replace(first.id, { name: 'Replacement' })).toEqual(expected)
    expect(await controller.get(first.id)).toEqual(expected)
    expect(await controller.get(second.id)).toEqual(second)
  } finally {
    backend.close()
  }
})

test('delete removes only the addressed resource and reports absence', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const first = await cars.create({ make: 'Toyota' })
    const second = await cars.create({ make: 'Honda' })

    expect(await cars.delete(first.id)).toBe(true)
    expect(await cars.delete(first.id)).toBe(false)
    expect(await cars.get(first.id)).toBeNull()
    expect(await cars.get(second.id)).toEqual(second)
  } finally {
    backend.close()
  }
})

test('get returns one resource or null', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const first = await cars.create({ make: 'Toyota' })
    const second = await cars.create({ make: 'Honda' })

    expect(await cars.get(first.id)).toEqual(first)
    expect(await cars.get(second.id)).toEqual(second)
    expect(await cars.get(crypto.randomUUID())).toBeNull()
  } finally {
    backend.close()
  }
})

test('list returns matching resources in insertion order', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const first = await cars.create({ make: 'Toyota', year: 2024 })
    const second = await cars.create({ make: 'Honda', year: 2024 })
    const third = await cars.create({ make: 'Toyota', year: 2025 })

    expect(await cars.list()).toEqual([first, second, third])
    expect(await cars.list({})).toEqual([first, second, third])
    expect(await cars.list({ make: 'Toyota' })).toEqual([first, third])
    expect(await cars.list({ make: 'Toyota', year: 2025 })).toEqual([third])
    expect(await cars.list({ make: 'Honda', year: 2025 })).toEqual([])
  } finally {
    backend.close()
  }
})

test('resource operations reject invalid IDs and filters without changing data', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const car = await cars.create({ make: 'Toyota' })

    await expect(cars.get('bad')).rejects.toThrow()
    await expect(cars.update('bad', { make: 'Honda' })).rejects.toThrow()
    await expect(cars.replace('bad', { make: 'Honda' })).rejects.toThrow()
    await expect(cars.delete('bad')).rejects.toThrow()

    for (const filter of [
      { missing: 'x' },
      { year: '2024' },
      { make: ['Toyota'] },
      { year: Infinity },
      { [Symbol('key')]: 'x' },
      { constructor: 'x' },
      JSON.parse('{"__proto__":"x"}'),
    ]) {
      await expect(cars.list(filter as never)).rejects.toThrow()
    }
    expect(await cars.list()).toEqual([car])
  } finally {
    backend.close()
  }
})

test('mutations reject an ID in their input and preserve stored resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)

  try {
    const car = await cars.create({ make: 'Toyota' })

    // @ts-expect-error The resource ID is immutable.
    await expect(cars.update(car.id, { id: car.id })).rejects.toThrow()
    // @ts-expect-error A replacement cannot include an ID.
    await expect(cars.replace(car.id, { id: car.id, make: 'Honda' })).rejects.toThrow()
    expect(await cars.get(car.id)).toEqual(car)
  } finally {
    backend.close()
  }
})

test('invalid updates and replacements leave the resource unchanged', async () => {
  const backend = new SqliteBackend(':memory:')
  const Range = Resource.extend({ min: z.number(), max: z.number() }).refine((value) => value.min <= value.max)
  const ranges = new Controller('ranges', Range, backend)

  try {
    const range = await ranges.create({ min: 1, max: 4 })

    await expect(ranges.update(range.id, { min: 5 })).rejects.toThrow()
    await expect(ranges.update(range.id, { min: '2' } as never)).rejects.toThrow()
    await expect(ranges.replace(range.id, { min: 5, max: 4 })).rejects.toThrow()
    await expect(ranges.replace(range.id, { min: 2 } as never)).rejects.toThrow()
    expect(await ranges.get(range.id)).toEqual(range)
  } finally {
    backend.close()
  }
})

test('update and replace return null without inserting missing resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller('cars', Car, backend)
  const id = crypto.randomUUID()

  try {
    expect(await cars.update(id, { make: 'Toyota' })).toBeNull()
    expect(await cars.replace(id, { make: 'Honda' })).toBeNull()
    expect(await cars.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('resource models retain their unknown-property policy', async () => {
  const backend = new SqliteBackend(':memory:')
  const normal = new Controller('normal', Resource.extend({ name: z.string() }), backend)
  const strict = new Controller('strict', z.strictObject({ id: z.uuid(), name: z.string() }), backend)
  const loose = new Controller('loose', z.looseObject({ id: z.uuid(), name: z.string() }), backend)
  const input = { name: 'One', extra: 'value' }

  try {
    const stripped = await normal.create(input)
    const retained = await loose.create(input)

    expect(stripped).toEqual({ id: stripped.id, name: 'One' })
    expect(retained).toEqual({ id: retained.id, name: 'One', extra: 'value' })
    await expect(strict.create(input)).rejects.toThrow()
    expect(await strict.list()).toEqual([])
    const strictRecord = await strict.create({ name: 'One' })

    await expect(strict.update(strictRecord.id, { extra: 'value' } as never)).rejects.toThrow()
    await expect(strict.update(strictRecord.id, JSON.parse('{"__proto__":"value"}'))).rejects.toThrow()
    expect(await strict.get(strictRecord.id)).toEqual(strictRecord)
  } finally {
    backend.close()
  }
})

test('loose and catchall models retain required input attributes', async () => {
  const backend = new SqliteBackend(':memory:')
  const Loose = Resource.extend({ name: z.string() }).loose()
  const Catchall = Resource.extend({ name: z.string() }).catchall(z.union([z.string(), z.number()]))
  const loose = new Controller('loose-input', Loose, backend)
  const catchall = new Controller('catchall-input', Catchall, backend)

  try {
    // @ts-expect-error Loose models still require their declared name field.
    await expect(loose.create({})).rejects.toThrow()
    // @ts-expect-error Catchall models still require their declared name field.
    await expect(catchall.create({})).rejects.toThrow()
    const first = await loose.create({ name: 'Loose', extra: { enabled: true } })
    const second = await catchall.create({ name: 'Catchall', extra: 42 })

    expect(first).toEqual({ id: first.id, name: 'Loose', extra: { enabled: true } })
    expect(second).toEqual({ id: second.id, name: 'Catchall', extra: 42 })
    // @ts-expect-error Replacement still requires the declared name field.
    await expect(loose.replace(first.id, {})).rejects.toThrow()
    // @ts-expect-error Replacement still requires the declared name field.
    await expect(catchall.replace(second.id, {})).rejects.toThrow()
    // @ts-expect-error The controller owns the ID even with an open model.
    await expect(loose.create({ id: crypto.randomUUID(), name: 'Other' })).rejects.toThrow()
    // @ts-expect-error A catchall model does not permit a caller-supplied ID.
    await expect(catchall.create({ id: crypto.randomUUID(), name: 'Other' })).rejects.toThrow()
    // @ts-expect-error A catchall model cannot change a resource ID.
    await expect(catchall.update(second.id, { id: second.id })).rejects.toThrow()
    // @ts-expect-error An open-model replacement cannot supply a resource ID.
    await expect(loose.replace(first.id, { id: first.id, name: 'Other' })).rejects.toThrow()
    // @ts-expect-error Catchall values must match the catchall schema.
    await expect(catchall.create({ name: 'Other', extra: true })).rejects.toThrow()
    expect(await loose.replace(first.id, { name: 'Loose', extra: { enabled: true } })).toEqual(first)
    expect(await catchall.replace(second.id, { name: 'Catchall', extra: 42 })).toEqual(second)
    expect(await catchall.update(second.id, { extra: 42 })).toEqual(second)
    expect(await loose.get(first.id)).toEqual(first)
    expect(await catchall.get(second.id)).toEqual(second)
  } finally {
    backend.close()
  }
})

test('resource filters distinguish scalar types, null and literal punctuation', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({
    'a.b': z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  })
  const controller = new Controller('items', Model, backend)
  const literal = "' OR 1=1 --"

  try {
    const number = await controller.create({ 'a.b': literal, value: 1 })
    const string = await controller.create({ 'a.b': literal, value: '1' })
    const boolean = await controller.create({ 'a.b': literal, value: true })
    const nullable = await controller.create({ 'a.b': literal, value: null })

    await controller.create({ 'a.b': literal })
    expect(await controller.list({ 'a.b': literal, value: 1 })).toEqual([number])
    expect(await controller.list({ value: '1' })).toEqual([string])
    expect(await controller.list({ value: true })).toEqual([boolean])
    expect(await controller.list({ value: null })).toEqual([nullable])
  } finally {
    backend.close()
  }
})

test('resources reject non-JSON and unstable model results before storage', async () => {
  const backend = new SqliteBackend(':memory:')
  const Values = Resource.extend({ value: z.unknown() })
  const Changing = Resource.extend({ value: z.number().transform((value) => value + 1) })
  const Mutating = Resource.extend({
    value: z.unknown().transform((value) => {
      const item = value as { count: number }

      item.count += 1

      return item
    }),
  })
  const values = new Controller('values', Values, backend)
  const changing = new Controller('changing', Changing, backend)
  const mutating = new Controller('mutating', Mutating, backend)
  const cycle: { self?: unknown } = {}

  cycle.self = cycle

  try {
    for (const value of [undefined, Infinity, 1n, new Date(), new Map(), cycle, { [Symbol('key')]: 'value' }]) {
      await expect(values.create({ value })).rejects.toThrow()
    }
    await expect(changing.create({ value: 1 })).rejects.toThrow('stable JSON')
    await expect(mutating.create({ value: { count: 0 } })).rejects.toThrow('stable JSON')
    expect(await values.list()).toEqual([])
    expect(await changing.list()).toEqual([])
    expect(await mutating.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('resources preserve literal JSON property names across storage', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new Controller('items', Resource.extend({ value: z.unknown() }), backend)

  try {
    const value = JSON.parse('{"nested":{"__proto__":"literal"}}')
    const record = await controller.create({ value })

    expect(await controller.get(record.id)).toEqual(record)
  } finally {
    backend.close()
  }
})

test('mutating transformations cannot change stored resources across operations', async () => {
  const backend = new SqliteBackend(':memory:')
  const original = new Controller('items', Resource.extend({ value: z.unknown() }), backend)
  const changing = new Controller(
    'items',
    Resource.extend({
      value: z.unknown().transform((value) => {
        const item = value as { count: number }

        item.count += 1

        return item
      }),
    }),
    backend,
  )

  try {
    const record = await original.create({ value: { count: 0 } })

    await expect(changing.get(record.id)).rejects.toThrow('stable JSON')
    await expect(changing.list()).rejects.toThrow('stable JSON')
    await expect(changing.update(record.id, {})).rejects.toThrow('stable JSON')
    await expect(changing.replace(record.id, { value: { count: 0 } })).rejects.toThrow('stable JSON')
    expect(await original.get(record.id)).toEqual(record)
  } finally {
    backend.close()
  }
})

test('reads validate persisted records against the current resource model', async () => {
  const backend = new SqliteBackend(':memory:')
  const original = new Controller('items', Resource.extend({ value: z.number() }), backend)
  const stricter = new Controller('items', Resource.extend({ value: z.string() }), backend)

  try {
    const record = await original.create({ value: 1 })

    await expect(stricter.get(record.id)).rejects.toThrow()
    await expect(stricter.list()).rejects.toThrow()
    await expect(stricter.update(record.id, { value: 'new' })).rejects.toThrow()
    expect(await original.get(record.id)).toEqual(record)
  } finally {
    backend.close()
  }
})

test('controllers reject asynchronous resource refinements', async () => {
  const backend = new SqliteBackend(':memory:')
  const model = Resource.extend({ name: z.string() }).refine(async () => true)
  const controller = new Controller('items', model, backend)

  try {
    await expect(controller.create({ name: 'One' })).rejects.toThrow()
    expect(await backend.select('items')).toEqual([])
  } finally {
    backend.close()
  }
})

test('native write failures leave persisted resources unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-controller-'))
  const path = join(dir, 'db.sqlite')
  const first = new SqliteBackend(path)
  const cars = new Controller('cars', Car, first)
  let second: SqliteBackend | undefined

  try {
    const car = await cars.create({ make: 'Toyota' })

    first.close()
    await expect(cars.update(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(cars.replace(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(cars.delete(car.id)).rejects.toThrow()
    second = new SqliteBackend(path)
    expect(await new Controller('cars', Car, second).get(car.id)).toEqual(car)
  } finally {
    first.close()
    second?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
