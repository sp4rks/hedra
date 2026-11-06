import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Controller, Hedra, Resource } from '#hedra.ts'

const Car = Resource.extend({ make: z.string() })

type Car = z.output<typeof Car>
const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
  HEDRA_SQLITE_PATH: ':memory:',
}

test('Collection binds resource metadata and rejects invalid definitions', () => {
  const cars = new Collection('cars', Car)

  expect(cars.name).toBe('cars')
  expect(cars.endpoint).toBe('/cars')
  expect(cars.model).toBe(Car)
  expect(() => cars.controller).toThrow('registered')

  for (const name of ['', 'Cars', '../cars', 'cars/other', '1cars']) {
    expect(() => new Collection(name, Car)).toThrow()
  }
  expect(() => new Collection('cars', z.string() as never)).toThrow()
  expect(() => new Collection('cars', z.object({ make: z.string() }))).toThrow()
  expect(() => new Collection('cars', z.object({ id: z.string(), make: z.string() }))).toThrow()
  expect(() => new Collection('cars', Resource.extend({ id: Resource.shape.id.optional() }))).toThrow()
  expect(() => new Collection('cars', Resource.extend({ id: Resource.shape.id.nullable() }))).toThrow()
  expect(
    () => new Collection('cars', Resource.extend({ id: Resource.shape.id.default(crypto.randomUUID()) })),
  ).toThrow()
  expect(() => new Collection('cars', Car, {} as never)).toThrow()
  expect(
    new Collection(
      'cars-v2_archive',
      Car.refine(() => true),
    ),
  ).toBeInstanceOf(Collection)
})

test('registration constructs the default controller using the collection table', async () => {
  const app = new Hedra({ env: quiet })
  const cars = new Collection('cars', Car)
  const bikes = new Collection('bikes', Car)

  try {
    app.register(cars)
    app.register(bikes)
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(await cars.controller.get(car.id)).toEqual(car)
    expect(await bikes.controller.list()).toEqual([])
  } finally {
    app.close()
  }
})

test('collection controllers infer prepared model output, including loose fields', async () => {
  const app = new Hedra({ env: quiet })
  const LooseModel = Resource.extend({ name: z.string().default('default') }).loose()
  const CatchallModel = Resource.extend({ name: z.string() }).catchall(z.union([z.string(), z.number()]))
  const loose = new Collection('loose', LooseModel)
  const catchall = new Collection('catchall', CatchallModel)

  try {
    app.register(loose)
    app.register(catchall)
    // @ts-expect-error The model output requires the defaulted name before controller calls.
    const missingLoose = await loose.controller.create({})
    // @ts-expect-error The catchall model still requires its declared name.
    const missingCatchall = await catchall.controller.create({})
    const first = await loose.controller.create({ name: 'Loose', extra: { enabled: true } })
    const second = await catchall.controller.create({ name: 'Catchall', extra: 42 })

    expect(missingLoose).not.toHaveProperty('name')
    expect(missingCatchall).not.toHaveProperty('name')
    // @ts-expect-error Model-derived open data cannot provide the server-owned ID.
    await expect(loose.controller.update(first.id, { id: first.id })).rejects.toThrow()
    // @ts-expect-error A catchall model does not permit a caller-supplied ID.
    await expect(catchall.controller.create({ id: crypto.randomUUID(), name: 'Other' })).rejects.toThrow()
    expect(await loose.controller.get(first.id)).toEqual(first)
    expect(await catchall.controller.get(second.id)).toEqual(second)
  } finally {
    app.close()
  }
})

test('collection registration does not make the controller run the resource model', async () => {
  const app = new Hedra({ env: quiet })
  const model = Resource.extend({ name: z.string() }).refine(() => false)
  const collection = new Collection('items', model)

  try {
    app.register(collection)
    const item = await collection.controller.create({ name: 'Supplied data' })

    expect(await collection.controller.get(item.id)).toEqual(item)
  } finally {
    app.close()
  }
})

class CarController extends Controller<Car> {
  /** Returns cars matching a maker. */
  async byMake(make: string) {
    return this.list({ make })
  }
}

test('an explicitly typed custom controller requires its constructor', () => {
  // @ts-expect-error A custom controller type requires the matching constructor.
  const cars = new Collection<typeof Car, CarController>('cars', Car)
  const base = new Collection<typeof Car, Controller<Car>>('cars', Car)
  const custom = new Collection<typeof Car, CarController>('cars', Car, CarController)

  expect(() => cars.controller).toThrow('registered')
  expect(() => base.controller).toThrow('registered')
  expect(() => custom.controller).toThrow('registered')
})

test('registration preserves a custom controller and its additional operations', async () => {
  const app = new Hedra({ env: quiet })
  const cars = new Collection('cars', Car, CarController)

  try {
    app.register(cars)
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(cars.controller).toBeInstanceOf(CarController)
    expect(await cars.controller.byMake('Toyota')).toEqual([car])
    expect(await cars.controller.byMake('Honda')).toEqual([])
  } finally {
    app.close()
  }
})
