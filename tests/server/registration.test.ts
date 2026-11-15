import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Backend, ControllerInterface } from '#hedra.ts'
import { BaseController, Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource } from '#hedra.ts'
import { request } from '../fixtures/scope.ts'

const Car = Resource.extend({ make: z.string() })
const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
  HEDRA_SQLITE_PATH: ':memory:',
}

test('registration validates root names, identity and controller options before binding', () => {
  const app = new Hedra({ config: new Config(quiet) })

  try {
    for (const name of ['', 'Cars', '../cars', 'cars/other', '1cars'])
      expect(() => app.register(Car.meta({ name }))).toThrow()
    expect(() => app.register(z.string() as never)).toThrow()
    expect(() => app.register(z.object({ make: z.string() }).meta({ name: 'cars' }))).toThrow()

    for (const id of [
      z.string(),
      Resource.shape.id.optional(),
      Resource.shape.id.nullable(),
      Resource.shape.id.default(crypto.randomUUID()),
    ])
      expect(() => app.register(Resource.extend({ id }).meta({ name: 'cars' }))).toThrow()
    const cars = Car.meta({ name: 'cars' })

    expect(() => app.register(cars, { controller: {} } as never)).toThrow()
    expect(() => app.register(cars, { unsupported: true } as never)).toThrow()
    expect(() => app.register(cars, null as never)).toThrow()
    expect(app.register(Car.refine(() => true).meta({ name: 'cars-v2_archive' }))).toBeInstanceOf(BaseController)
  } finally {
    app.close()
  }
})

test('registration requires every core field on roots and managed children before construction', () => {
  const app = new Hedra({ config: new Config(quiet) })
  let constructed = 0

  class Observed extends BaseController {
    /** Records whether invalid registration reached a controller constructor. */
    constructor(backend: Backend) {
      super(backend)
      constructed++
    }
  }

  try {
    for (const key of ['createdAt', 'updatedAt', 'environmentDomain'] as const) {
      const field = Resource.shape[key]
      const variants = [
        Resource.omit({ [key]: true } as never),
        Resource.extend({ [key]: field.optional() }),
        Resource.extend({ [key]: field.nullable() }),
        Resource.extend({ [key]: z.number() }),
        Resource.extend({ [key]: field.default('default') }),
      ]

      for (const variant of variants) {
        expect(() => app.register(variant.meta({ name: 'invalid' }), { controller: Observed })).toThrow()
        const child = variant.meta({ child: true })
        const root = Resource.extend({ child }).meta({ name: 'invalid' })

        expect(() => app.register(root, { controller: Observed })).toThrow()
      }
    }
    expect(constructed).toBe(0)
    expect(app.register(Car.meta({ name: 'invalid' }))).toBeInstanceOf(BaseController)
    const independent = z.object({
      id: z.uuid().refine(() => true),
      createdAt: z.iso.datetime().refine(() => true),
      updatedAt: z.string().datetime(),
      environmentDomain: Resource.shape.environmentDomain.refine(() => true),
    })

    expect(app.register(independent.meta({ name: 'independent' }))).toBeInstanceOf(BaseController)
  } finally {
    app.close()
  }
})

test('registration constructs the default independent controller', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const cars = Car.meta({ name: 'cars' })
  const bikes = Car.meta({ name: 'bikes' })

  try {
    const carsController = app.register(cars)
    const bikesController = app.register(bikes)

    app.scoped.post('/manual/cars', async (context) =>
      context.json(await carsController.create(context, cars, { make: 'Toyota' })),
    )
    app.scoped.get('/manual/bikes', async (context) =>
      context.json(await bikesController.list(context, bikes, 'http://localhost/bikes')),
    )
    const created = JsonApiResponse.parse(await (await request(app, '/manual/cars', { method: 'POST' })).json())

    expect(carsController).toBeInstanceOf(BaseController)
    expect(created.data.make).toBe('Toyota')
    expect(JsonApiListResponse.parse(await (await request(app, '/manual/bikes')).json()).data).toEqual([])
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
  byMake(context: Context, collection: z.ZodObject, make: string) {
    return this.list(context, collection, 'http://localhost/cars', { filter: { make } })
  }
}

test('registration preserves a custom independent controller and its extra methods', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const cars = Car.meta({ name: 'cars' })

  try {
    const carsController = app.register(cars, { controller: CustomController })

    app.scoped.post('/manual/cars', async (context) =>
      context.json(await carsController.create(context, cars, { make: 'Toyota' })),
    )
    app.scoped.get('/manual/cars', async (context) =>
      context.json(await carsController.byMake(context, cars, 'Toyota')),
    )
    const created = JsonApiResponse.parse(await (await request(app, '/manual/cars', { method: 'POST' })).json())

    expect(carsController).toBeInstanceOf(CustomController)
    expect(JsonApiListResponse.parse(await (await request(app, '/manual/cars')).json()).data).toEqual([created.data])
  } finally {
    app.close()
  }
})
