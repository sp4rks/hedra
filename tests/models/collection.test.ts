import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Controller, Hedra, Resource } from '#hedra.ts'

const Car = Resource.extend({ make: z.string() })
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

test('registration constructs the default controller with the collection model and table', async () => {
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

class CarController extends Controller<typeof Car> {
  /** Returns cars matching a maker. */
  async byMake(make: string) {
    return this.list({ make })
  }
}

test('an explicitly typed custom controller requires its constructor', () => {
  // @ts-expect-error A custom controller type requires the matching constructor.
  const cars = new Collection<typeof Car, CarController>('cars', Car)
  const base = new Collection<typeof Car, Controller<typeof Car>>('cars', Car)
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
