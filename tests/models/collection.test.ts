import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Backend, ControllerInterface } from '#hedra.ts'
import {
  BaseController,
  Collection,
  Config,
  EmbeddedResource,
  Hedra,
  JsonApiListResponse,
  JsonApiResponse,
  Resource,
} from '#hedra.ts'

const Car = Resource.extend({ make: z.string() })
const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
  HEDRA_SQLITE_PATH: ':memory:',
}

test('Collection binds metadata, a public validator and rejects invalid definitions', () => {
  const cars = new Collection('cars', Car)

  expect(cars.name).toBe('cars')
  expect(cars.endpoint).toBe('/cars')
  expect(cars.model).toBe(Car)
  expect(cars.outputValidator).toBeInstanceOf(z.ZodObject)
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
  expect(() => new Collection('cars', Car, { controller: {} } as never)).toThrow()
  expect(() => new Collection('cars', Car, { unsupported: true } as never)).toThrow()
  expect(() => new Collection('cars', Car, null as never)).toThrow()
  expect(
    new Collection(
      'cars-v2_archive',
      Car.refine(() => true),
    ),
  ).toBeInstanceOf(Collection)
})

test('collections reject embedded resource definitions in unsupported wrapper shapes', () => {
  const Note = EmbeddedResource.extend({ text: z.string(), password: z.string() })
  const models = [
    Resource.extend({ profile: z.object({ note: Note }) }),
    Resource.extend({ notes: z.array(z.array(Note)) }),
    Resource.extend({ note: z.union([Note, z.string()]) }),
    Resource.extend({ note: z.lazy(() => Note) }),
  ]

  for (const model of models) expect(() => new Collection('cars', model)).toThrow('Unsupported embedded')
})

test('registration constructs the default independent controller', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const cars = new Collection('cars', Car)
  const bikes = new Collection('bikes', Car)

  try {
    app.register(cars)
    app.register(bikes)
    app.post('/manual/cars', async (context) =>
      context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
    )
    app.get('/manual/bikes', async (context) =>
      context.json(await bikes.controller.list(context, bikes, 'http://localhost/bikes')),
    )
    const created = JsonApiResponse.parse(await (await app.request('/manual/cars', { method: 'POST' })).json())

    expect(cars.controller).toBeInstanceOf(BaseController)
    expect(created.data.make).toBe('Toyota')
    expect(JsonApiListResponse.parse(await (await app.request('/manual/bikes')).json()).data).toEqual([])
  } finally {
    app.close()
  }
})

class CustomController implements ControllerInterface {
  private readonly base: BaseController

  /** Delegates shared resource behaviour to the supplied backend. */
  constructor(backend: Backend) {
    this.base = new BaseController(backend)
  }

  /** Creates a resource. */
  create(...args: Parameters<ControllerInterface['create']>) {
    return this.base.create(...args)
  }
  /** Reads a resource. */
  id(...args: Parameters<ControllerInterface['id']>) {
    return this.base.id(...args)
  }
  /** Lists resources. */
  list(...args: Parameters<ControllerInterface['list']>) {
    return this.base.list(...args)
  }
  /** Updates a resource. */
  update(...args: Parameters<ControllerInterface['update']>) {
    return this.base.update(...args)
  }
  /** Deletes a resource. */
  delete(...args: Parameters<ControllerInterface['delete']>) {
    return this.base.delete(...args)
  }
  /** Lists cars matching one maker. */
  byMake(context: Context, collection: Collection, make: string) {
    return this.list(context, collection, 'http://localhost/cars', { filter: { make } })
  }
}

test('an explicitly typed custom controller requires its constructor', () => {
  // @ts-expect-error A custom controller type requires the matching constructor.
  const cars = new Collection<typeof Car, CustomController>('cars', Car)
  const base = new Collection<typeof Car, ControllerInterface>('cars', Car)
  const custom = new Collection<typeof Car, CustomController>('cars', Car, { controller: CustomController })

  expect(() => cars.controller).toThrow('registered')
  expect(() => base.controller).toThrow('registered')
  expect(() => custom.controller).toThrow('registered')
})

test('registration preserves a custom independent controller and its extra methods', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const cars = new Collection('cars', Car, { controller: CustomController })

  try {
    app.register(cars)
    app.post('/manual/cars', async (context) =>
      context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
    )
    app.get('/manual/cars', async (context) => context.json(await cars.controller.byMake(context, cars, 'Toyota')))
    const created = JsonApiResponse.parse(await (await app.request('/manual/cars', { method: 'POST' })).json())

    expect(cars.controller).toBeInstanceOf(CustomController)
    expect(JsonApiListResponse.parse(await (await app.request('/manual/cars')).json()).data).toEqual([created.data])
  } finally {
    app.close()
  }
})
