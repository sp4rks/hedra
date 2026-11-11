import { z } from 'zod'

import { Collection, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const cars = new Collection('cars', CarModel)

// Registration selects BaseController, derives input validators and installs the five CRUD routes.
app.register(cars)

try {
  // app.request supplies real HTTP contexts without opening a listener.
  const response = await app.request('/cars', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ make: 'Toyota', model: 'Corolla', year: 2024 }),
  })
  const created = JsonApiResponse.parse(await response.json())
  const car: CarModel = CarModel.parse(created.data)
  const found = await app.request(`/cars/${car.id}`)

  CarModel.parse(JsonApiResponse.parse(await found.json()).data)

  const query = new URLSearchParams({ filter: JSON.stringify({ make: 'Toyota' }) })
  const listed = await app.request(`/cars?${query}`)

  z.array(CarModel).parse(JsonApiListResponse.parse(await listed.json()).data)

  // PATCH changes the year while preserving the ID and creation timestamp.
  const changed = await app.request(`/cars/${car.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ year: 2025 }),
  })

  CarModel.parse(JsonApiResponse.parse(await changed.json()).data)
  await app.request(`/cars/${car.id}`, { method: 'DELETE' })
} finally {
  app.close()
  backend.close()
}
