import assert from 'node:assert/strict'
import { z } from 'zod'

import { Collection, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const CreateCar = CarModel.omit({ id: true, createdAt: true, updatedAt: true }).strict()
const UpdateCar = CreateCar.partial()
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const cars = new Collection('cars', CarModel)

// Registration selects BaseController; Car needs no specific controller class.
app.register(cars)

// Routes illustrate the future Web layer, including pure input validation.
app.post('/cars', async (context) => {
  const input = CreateCar.parse(await context.req.json())

  return context.json(await cars.controller.create(context, cars, input), 201)
})
app.get('/cars/:id', async (context) => context.json(await cars.controller.id(context, cars, context.req.param('id'))))
app.get('/cars', async (context) => {
  const make = context.req.query('make')
  const query = make === undefined ? undefined : { filter: { make } }

  return context.json(await cars.controller.list(context, cars, context.req.url, query))
})
app.patch('/cars/:id', async (context) => {
  const input = UpdateCar.parse(await context.req.json())

  return context.json(await cars.controller.update(context, cars, input, context.req.param('id')))
})
app.delete('/cars/:id', async (context) => {
  await cars.controller.delete(context, cars, context.req.param('id'))

  return context.body(null, 204)
})

try {
  // app.request supplies real HTTP contexts without opening a listener.
  const response = await app.request('/cars', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ make: 'Toyota', model: 'Corolla', year: 2024 }),
  })
  const car: CarModel = CarModel.parse((await response.json()).data)

  assert.equal(response.status, 201)
  const found = await app.request(`/cars/${car.id}`)

  assert.deepEqual(CarModel.parse((await found.json()).data), car)
  const listed = await app.request('/cars?make=Toyota')

  assert.deepEqual(z.array(CarModel).parse((await listed.json()).data), [car])
  const changed = await app.request(`/cars/${car.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year: 2025 }),
  })
  const updated = CarModel.parse((await changed.json()).data)

  assert.equal(updated.id, car.id)
  assert.equal(updated.createdAt, car.createdAt)
  assert.equal(updated.year, 2025)
  assert.equal((await app.request(`/cars/${car.id}`, { method: 'DELETE' })).status, 204)
  const empty = await app.request('/cars')

  assert.deepEqual((await empty.json()).data, [])
} finally {
  app.close()
  backend.close()
}
