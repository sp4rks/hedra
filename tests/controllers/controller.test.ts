import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { Controller, Resource, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({ make: z.string().trim().min(1), year: z.number().int().default(2024) })

type Car = z.output<typeof CarModel>

test('controllers accept plain resource types without a model argument', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)

  try {
    const car = await cars.create({ make: ' Toyota ', year: 2024 })

    expect(car).toEqual({ id: car.id, make: ' Toyota ', year: 2024 })
    expect(await cars.get(car.id)).toEqual(car)
    expect(await cars.list()).toEqual([car])
    expect(await cars.update(car.id, { year: 2025 })).toEqual({ ...car, year: 2025 })
    expect(await cars.replace(car.id, { make: 'Honda', year: 2026 })).toEqual({ id: car.id, make: 'Honda', year: 2026 })
    expect(await cars.delete(car.id)).toBe(true)
    expect(await cars.get(car.id)).toBeNull()
  } finally {
    backend.close()
  }
})

test('caller validation prepares data before controller operations', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)
  const input = CarModel.omit({ id: true })

  try {
    const prepared = input.parse({ make: ' Toyota ' })
    const car = await cars.create(prepared)
    const direct = await cars.create({ make: ' Honda ', year: 2030 })

    expect(car).toEqual({ id: car.id, make: 'Toyota', year: 2024 })
    expect(await cars.get(car.id)).toEqual(car)
    expect(direct).toEqual({ id: direct.id, make: ' Honda ', year: 2030 })
    expect(await cars.get(direct.id)).toEqual(direct)
  } finally {
    backend.close()
  }
})

test('controller types describe prepared resource data and the two-argument constructor', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)
  const args: ConstructorParameters<typeof Controller<Car>> = ['cars', backend]
  // @ts-expect-error Controllers do not accept a resource model.
  const oldArgs: ConstructorParameters<typeof Controller<Car>> = ['cars', CarModel, backend]

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

test('controllers reject caller-owned changes to server resource IDs', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)

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

test('resource operations remain atomic and scoped to one ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({
    name: z.string(),
    engine: z.object({ fuel: z.string(), cylinders: z.number().optional() }),
    tags: z.array(z.string()),
    note: z.string().optional(),
  })
  const cars = new Controller<z.output<typeof Model>>('cars', backend)
  const bikes = new Controller<z.output<typeof Model>>('bikes', backend)

  try {
    const first = await cars.create({
      name: 'One',
      engine: { fuel: 'petrol', cylinders: 4 },
      tags: ['old'],
      note: 'keep',
    })
    const second = await cars.create({ name: 'Two', engine: { fuel: 'diesel' }, tags: [] })
    const bike = await bikes.create({ name: 'Bike', engine: { fuel: 'electric' }, tags: [] })
    const expected = { ...first, engine: { fuel: 'electric' }, tags: ['new'] }

    expect(await cars.update(first.id, { engine: { fuel: 'electric' }, tags: ['new'] })).toEqual(expected)
    expect(await cars.update(first.id, {})).toEqual(expected)
    await expect(cars.update(first.id, { note: undefined })).rejects.toThrow()
    expect(await cars.get(first.id)).toEqual(expected)
    expect(await cars.get(second.id)).toEqual(second)
    expect(await bikes.get(bike.id)).toEqual(bike)
    const replacement = { id: first.id, name: 'Replacement', engine: { fuel: 'electric' }, tags: [] }

    expect(await cars.replace(first.id, { name: 'Replacement', engine: { fuel: 'electric' }, tags: [] })).toEqual(
      replacement,
    )
    expect(await cars.get(first.id)).toEqual(replacement)
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

test('controller filters enforce generic scalar rules without a resource model', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)

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

test('controller filters distinguish scalar types and explicit null', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value?: string | number | boolean | null }
  const items = new Controller<Item>('items', backend)

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

test('controllers reject non-JSON attributes without changing persisted resources', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value: unknown }
  const items = new Controller<Item>('items', backend)
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

test('controllers return stored resource data without parsing it through a model', async () => {
  const backend = new SqliteBackend(':memory:')
  const cars = new Controller<Car>('cars', backend)
  const id = crypto.randomUUID()

  try {
    await backend.insert('cars', { id, make: 42, year: true })
    expect((await cars.get(id)) as unknown).toEqual({ id, make: 42, year: true })
    expect((await cars.list()) as unknown).toEqual([{ id, make: 42, year: true }])
    await backend.insert('cars', { id: 'not-a-uuid', make: 'Broken', year: 2024 })
    await expect(cars.list()).rejects.toThrow()
  } finally {
    backend.close()
  }
})

test('plain loose and catchall data retain required types and valid extra fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const LooseModel = Resource.extend({ name: z.string() }).loose()
  const CatchallModel = Resource.extend({ name: z.string() }).catchall(z.union([z.string(), z.number()]))
  const loose = new Controller<z.output<typeof LooseModel>>('loose-input', backend)
  const catchall = new Controller<z.output<typeof CatchallModel>>('catchall-input', backend)

  try {
    const first = await loose.create({ name: 'Loose', extra: { enabled: true } })
    const second = await catchall.create({ name: 'Catchall', extra: 42 })

    expect(first).toEqual({ id: first.id, name: 'Loose', extra: { enabled: true } })
    expect(second).toEqual({ id: second.id, name: 'Catchall', extra: 42 })
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

    expect(replacedLoose as unknown).toEqual({ id: first.id })
    expect(replacedCatchall as unknown).toEqual({ id: second.id })
    // @ts-expect-error Open data cannot provide the server-owned ID.
    await expect(loose.create({ id: crypto.randomUUID(), name: 'Other' })).rejects.toThrow()
    // @ts-expect-error Catchall data cannot change the server-owned ID.
    await expect(catchall.update(second.id, { id: second.id })).rejects.toThrow()
    // @ts-expect-error A catchall attribute has the declared scalar type.
    const unchecked = await catchall.create({ name: 'Other', extra: true })

    expect(unchecked as unknown).toEqual({ id: unchecked.id, name: 'Other', extra: true })
    expect(await loose.replace(first.id, { name: 'Loose', extra: { enabled: true } })).toEqual(first)
    expect(await catchall.replace(second.id, { name: 'Catchall', extra: 42 })).toEqual(second)
    expect(await catchall.update(second.id, { extra: 42 })).toEqual(second)
    expect(await loose.list({ name: 'Loose' })).toEqual([first])
    expect(await catchall.list({ name: 'Catchall' })).toEqual([second])
  } finally {
    backend.close()
  }
})

test('controllers preserve literal JSON property names across storage and filtering', async () => {
  const backend = new SqliteBackend(':memory:')

  type Item = Resource & { value: unknown }
  const items = new Controller<Item>('items', backend)

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
  const cars = new Controller<Car>('cars', first)
  let second: SqliteBackend | undefined

  try {
    const car = await cars.create({ make: 'Toyota', year: 2024 })

    first.close()
    await expect(cars.update(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(cars.replace(car.id, { make: 'Honda', year: 2025 })).rejects.toThrow()
    await expect(cars.delete(car.id)).rejects.toThrow()
    second = new SqliteBackend(path)
    expect(await new Controller<Car>('cars', second).get(car.id)).toEqual(car)
  } finally {
    first.close()
    second?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
