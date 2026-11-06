import { expect, setSystemTime, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { Resource, ResourceOperations, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({ make: z.string().trim().min(1), year: z.number().int().default(2024) })

type Car = z.output<typeof CarModel>

test('resource operations accept plain resource types without a model argument', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)

  try {
    const car = await cars.create({ make: ' Toyota ', year: 2024 })

    expect(car).toEqual({
      id: car.id,
      createdAt: car.createdAt,
      updatedAt: car.createdAt,
      make: ' Toyota ',
      year: 2024,
    })
    expect(await cars.get(car.id)).toEqual(car)
    expect(await cars.list()).toEqual([car])
    expect(await cars.update(car.id, { year: 2025 })).toEqual({ ...car, year: 2025, updatedAt: expect.any(String) })
    expect(await cars.replace(car.id, { make: 'Honda', year: 2026 })).toEqual({
      id: car.id,
      createdAt: car.createdAt,
      updatedAt: expect.any(String),
      make: 'Honda',
      year: 2026,
    })
    expect(await cars.delete(car.id)).toBe(true)
    expect(await cars.get(car.id)).toBeNull()
  } finally {
    backend.close()
  }
})

test('caller validation prepares data before resource operations', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)
  const input = CarModel.omit({ id: true, createdAt: true, updatedAt: true })

  try {
    const prepared = input.parse({ make: ' Toyota ' })
    const car = await cars.create(prepared)
    const direct = await cars.create({ make: ' Honda ', year: 2030 })

    expect(car).toEqual({ id: car.id, createdAt: car.createdAt, updatedAt: car.createdAt, make: 'Toyota', year: 2024 })
    expect(await cars.get(car.id)).toEqual(car)
    expect(direct).toEqual({
      id: direct.id,
      createdAt: direct.createdAt,
      updatedAt: direct.createdAt,
      make: ' Honda ',
      year: 2030,
    })
    expect(await cars.get(direct.id)).toEqual(direct)
  } finally {
    backend.close()
  }
})

test('resource operation types describe prepared data and the two-argument constructor', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)
  const args: ConstructorParameters<typeof ResourceOperations<Car>> = ['cars', backend]
  // @ts-expect-error Controllers do not accept a resource model.
  const oldArgs: ConstructorParameters<typeof ResourceOperations<Car>> = ['cars', CarModel, backend]

  try {
    // @ts-expect-error Prepared data requires the year even when the model supplies a default.
    const unprepared = await cars.create({ make: 'Toyota' })

    expect(args).toHaveLength(2)
    expect(oldArgs).toHaveLength(3)
    expect(unprepared).not.toHaveProperty('year')
    expect(await cars.get(unprepared.id)).toEqual(unprepared)
  } finally {
    backend.close()
  }
})

test('resource operations reject caller-owned changes to server resource IDs', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)

  try {
    const car = await cars.create({ make: 'Toyota', year: 2024 })
    const other = await cars.create({ make: 'Honda', year: 2025 })

    expect(Resource.shape.id.parse(car.id)).toBe(car.id)
    expect(car.id).not.toBe(other.id)
    // @ts-expect-error The controller generates the resource ID.
    await expect(cars.create({ id: crypto.randomUUID(), make: 'Ford', year: 2026 })).rejects.toThrow()
    await expect(cars.create({ id: undefined, make: 'Ford', year: 2026 })).rejects.toThrow()
    // @ts-expect-error An update cannot provide the resource ID.
    await expect(cars.update(car.id, { id: car.id })).rejects.toThrow()
    // @ts-expect-error A replacement cannot provide the resource ID.
    await expect(cars.replace(car.id, { id: car.id, make: 'Ford', year: 2026 })).rejects.toThrow()
    await expect(cars.get('bad')).rejects.toThrow()
    await expect(cars.update('bad', { year: 2026 })).rejects.toThrow()
    await expect(cars.replace('bad', { make: 'Ford', year: 2026 })).rejects.toThrow()
    await expect(cars.delete('bad')).rejects.toThrow()
    expect(await cars.list()).toEqual([car, other])
  } finally {
    backend.close()
  }
})

test('programmatic resource operations own timestamps and reject caller metadata', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)
  const createdAt = '2026-01-02T03:04:05.000Z'
  const updatedAt = '2026-02-03T04:05:06.000Z'

  try {
    setSystemTime(new Date(createdAt))
    const car = await cars.create({ make: 'Toyota', year: 2024 })

    expect(car).toEqual({ id: car.id, createdAt, updatedAt: createdAt, make: 'Toyota', year: 2024 })
    // @ts-expect-error Creation timestamps are server-owned.
    await expect(cars.create({ make: 'Honda', year: 2025, createdAt })).rejects.toThrow()
    // @ts-expect-error Update timestamps are server-owned.
    await expect(cars.update(car.id, { updatedAt })).rejects.toThrow()
    // @ts-expect-error Replacement cannot change server-owned metadata.
    await expect(cars.replace(car.id, { make: 'Honda', year: 2025, createdAt })).rejects.toThrow()
    setSystemTime(new Date(updatedAt))
    const changed = await cars.update(car.id, { year: 2025 })

    expect(changed).toEqual({ ...car, year: 2025, updatedAt })
    expect(await cars.get(car.id)).toEqual(changed)
  } finally {
    setSystemTime()
    backend.close()
  }
})

test('resource operations remain atomic and scoped to one ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({
    name: z.string(),
    engine: z.object({ fuel: z.string(), cylinders: z.number().optional() }),
    tags: z.array(z.string()),
    note: z.string().optional(),
  })
  const cars = new ResourceOperations<z.output<typeof Model>>('cars', backend)
  const bikes = new ResourceOperations<z.output<typeof Model>>('bikes', backend)

  try {
    const first = await cars.create({
      name: 'One',
      engine: { fuel: 'petrol', cylinders: 4 },
      tags: ['old'],
      note: 'keep',
    })
    const second = await cars.create({ name: 'Two', engine: { fuel: 'diesel' }, tags: [] })
    const bike = await bikes.create({ name: 'Bike', engine: { fuel: 'electric' }, tags: [] })
    const expected = { ...first, engine: { fuel: 'electric' }, tags: ['new'], updatedAt: expect.any(String) }

    expect(await cars.update(first.id, { engine: { fuel: 'electric' }, tags: ['new'] })).toEqual(expected)
    const updated = await cars.update(first.id, {})

    expect(updated).toEqual(expected)
    await expect(cars.update(first.id, { note: undefined })).rejects.toThrow()
    expect(await cars.get(first.id)).toEqual(updated)
    expect(await cars.get(second.id)).toEqual(second)
    expect(await bikes.get(bike.id)).toEqual(bike)
    const replacement = {
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: expect.any(String),
      name: 'Replacement',
      engine: { fuel: 'electric' },
      tags: [],
    }

    const replaced = await cars.replace(first.id, { name: 'Replacement', engine: { fuel: 'electric' }, tags: [] })

    expect(replaced).toEqual(replacement)
    expect(await cars.get(first.id)).toEqual(replaced)
    const missing = crypto.randomUUID()

    expect(await cars.get(missing)).toBeNull()
    expect(await cars.update(missing, { name: 'Missing' })).toBeNull()
    expect(await cars.replace(missing, { name: 'Missing', engine: { fuel: 'electric' }, tags: [] })).toBeNull()
    expect(await cars.delete(missing)).toBe(false)
    expect(await cars.delete(first.id)).toBe(true)
    expect(await cars.get(first.id)).toBeNull()
    expect(await cars.get(second.id)).toEqual(second)
  } finally {
    backend.close()
  }
})

test('resource filters enforce generic scalar rules without a resource model', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)

  try {
    const first = await cars.create({ make: 'Toyota', year: 2024 })
    const second = await cars.create({ make: 'Honda', year: 2024 })
    const third = await cars.create({ make: 'Toyota', year: 2025 })

    expect(await cars.list({ make: 'Toyota' })).toEqual([first, third])
    expect(await cars.list({ make: 'Toyota', year: 2025 })).toEqual([third])
    expect(await cars.list({ year: 2024 })).toEqual([first, second])
    // @ts-expect-error Fields not declared in Car are rejected statically.
    expect(await cars.list({ missing: 'value' })).toEqual([])
    // @ts-expect-error Car's year is numeric; the backend still handles generic scalar criteria.
    expect(await cars.list({ year: '2024' })).toEqual([])

    for (const filter of [
      { make: ['Toyota'] },
      { year: Infinity },
      { [Symbol('key')]: 'x' },
      JSON.parse('{"__proto__":{"nested":true}}'),
    ]) {
      await expect(cars.list(filter as never)).rejects.toThrow()
    }
    expect(await cars.list()).toEqual([first, second, third])
  } finally {
    backend.close()
  }
})

test('resource filters distinguish scalar types and explicit null', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value?: string | number | boolean | null }
  const items = new ResourceOperations<Item>('items', backend)

  try {
    const number = await items.create({ value: 1 })
    const string = await items.create({ value: '1' })
    const boolean = await items.create({ value: true })
    const nullable = await items.create({ value: null })

    await items.create({})
    expect(await items.list({ value: 1 })).toEqual([number])
    expect(await items.list({ value: '1' })).toEqual([string])
    expect(await items.list({ value: true })).toEqual([boolean])
    expect(await items.list({ value: null })).toEqual([nullable])
  } finally {
    backend.close()
  }
})

test('resource operations reject non-JSON attributes without changing persisted resources', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value: unknown }
  const items = new ResourceOperations<Item>('items', backend)
  const cycle: { self?: unknown } = {}

  cycle.self = cycle

  try {
    const item = await items.create({ value: 'safe' })

    for (const value of [undefined, Infinity, 1n, new Date(), new Map(), cycle, { [Symbol('key')]: 'value' }]) {
      await expect(items.create({ value })).rejects.toThrow()
      await expect(items.update(item.id, { value })).rejects.toThrow()
      await expect(items.replace(item.id, { value })).rejects.toThrow()
    }
    expect(await items.get(item.id)).toEqual(item)
    expect(await items.list()).toEqual([item])
  } finally {
    backend.close()
  }
})

test('resource operations return stored data without parsing it through a model', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new ResourceOperations<Car>('cars', backend)
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  try {
    await backend.insert('cars', { id, make: 42, year: true, createdAt: timestamp, updatedAt: timestamp })
    expect((await cars.get(id)) as unknown).toEqual({
      id,
      make: 42,
      year: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    expect((await cars.list()) as unknown).toEqual([
      { id, make: 42, year: true, createdAt: timestamp, updatedAt: timestamp },
    ])
    await backend.insert('cars', {
      id: 'not-a-uuid',
      make: 'Broken',
      year: 2024,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    await expect(cars.list()).rejects.toThrow()
  } finally {
    backend.close()
  }
})

test('plain loose and catchall data retain required types and valid extra fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const LooseModel = Resource.extend({ name: z.string() }).loose()
  const CatchallModel = Resource.extend({ name: z.string() }).catchall(z.union([z.string(), z.number()]))
  const loose = new ResourceOperations<z.output<typeof LooseModel>>('loose-input', backend)
  const catchall = new ResourceOperations<z.output<typeof CatchallModel>>('catchall-input', backend)

  try {
    const first = await loose.create({ name: 'Loose', extra: { enabled: true } })
    const second = await catchall.create({ name: 'Catchall', extra: 42 })

    expect(first).toEqual({
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: first.createdAt,
      name: 'Loose',
      extra: { enabled: true },
    })
    expect(second).toEqual({
      id: second.id,
      createdAt: second.createdAt,
      updatedAt: second.createdAt,
      name: 'Catchall',
      extra: 42,
    })
    // @ts-expect-error Loose data still requires its declared name field.
    const missingLoose = await loose.create({})
    // @ts-expect-error Catchall data still requires its declared name field.
    const missingCatchall = await catchall.create({})

    expect(missingLoose).not.toHaveProperty('name')
    expect(missingCatchall).not.toHaveProperty('name')
    // @ts-expect-error Replacement still requires the declared name field.
    const replacedLoose = await loose.replace(first.id, {})
    // @ts-expect-error Replacement still requires the declared name field.
    const replacedCatchall = await catchall.replace(second.id, {})

    expect(replacedLoose as unknown).toEqual({
      id: first.id,
      createdAt: first.createdAt,
      updatedAt: expect.any(String),
    })
    expect(replacedCatchall as unknown).toEqual({
      id: second.id,
      createdAt: second.createdAt,
      updatedAt: expect.any(String),
    })
    // @ts-expect-error Open data cannot provide the server-owned ID.
    await expect(loose.create({ id: crypto.randomUUID(), name: 'Other' })).rejects.toThrow()
    // @ts-expect-error Catchall data cannot change the server-owned ID.
    await expect(catchall.update(second.id, { id: second.id })).rejects.toThrow()
    // @ts-expect-error A catchall attribute has the declared scalar type.
    const unchecked = await catchall.create({ name: 'Other', extra: true })

    expect(unchecked as unknown).toEqual({
      id: unchecked.id,
      createdAt: unchecked.createdAt,
      updatedAt: unchecked.createdAt,
      name: 'Other',
      extra: true,
    })
    const restoredLoose = await loose.replace(first.id, { name: 'Loose', extra: { enabled: true } })
    const restoredCatchall = await catchall.replace(second.id, { name: 'Catchall', extra: 42 })
    const updatedCatchall = await catchall.update(second.id, { extra: 42 })

    expect(restoredLoose).toEqual({ ...first, updatedAt: expect.any(String) })
    expect(restoredCatchall).toEqual({ ...second, updatedAt: expect.any(String) })
    expect(updatedCatchall).toEqual({ ...second, updatedAt: expect.any(String) })
    if (!restoredLoose || !updatedCatchall) throw new Error('Expected restored resources')
    expect(await loose.list({ name: 'Loose' })).toEqual([restoredLoose])
    expect(await catchall.list({ name: 'Catchall' })).toEqual([updatedCatchall])
  } finally {
    backend.close()
  }
})

test('resource operations preserve literal JSON property names across storage and filtering', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value: unknown }
  const items = new ResourceOperations<Item>('items', backend)

  try {
    const value = JSON.parse('{"nested":{"__proto__":"literal"}}')
    const item = await items.create({ value })
    const special = JSON.parse('{"id":"placeholder","value":"x","__proto__":"literal"}')

    delete special.id
    const other = await items.create(special)

    expect(await items.get(item.id)).toEqual(item)
    expect(await items.list(JSON.parse('{"__proto__":"literal"}'))).toEqual([other])
  } finally {
    backend.close()
  }
})

test('backend write failures leave persisted resources unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-controller-'))
  const path = join(dir, 'db.sqlite')
  const first = new SqliteBackend(path)
  const cars = new ResourceOperations<Car>('cars', first)
  let second: SqliteBackend | undefined

  try {
    const car = await cars.create({ make: 'Toyota', year: 2024 })

    first.close()
    await expect(cars.update(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(cars.replace(car.id, { make: 'Honda', year: 2025 })).rejects.toThrow()
    await expect(cars.delete(car.id)).rejects.toThrow()
    second = new SqliteBackend(path)
    expect(await new ResourceOperations<Car>('cars', second).get(car.id)).toEqual(car)
  } finally {
    first.close()
    second?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
