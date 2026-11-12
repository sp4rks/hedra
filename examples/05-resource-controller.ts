// Use all five generated REST operations for a model-backed collection.
// app.request runs the routes in this process, so no network listener is needed.

import { z } from 'zod'

import { Collection, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

// Define the car's stored attributes and infer its TypeScript type from the same schema.
const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

// Supply an in-memory backend that this example owns and will close itself.
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const cars = new Collection('cars', CarModel)

// Registration selects BaseController, derives validators and installs the collection's routes.
app.register(cars)

try {
  // POST creates a car and assigns its ID and audit timestamps.
  const response = await app.request('/cars', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ make: 'Toyota', model: 'Corolla', year: 2024 }),
  })
  // Parse the response envelope and validate the car before using its ID.
  const created = JsonApiResponse.parse(await response.json())
  const car: CarModel = CarModel.parse(created.data)
  // Read the saved car through its item route.
  const found = await app.request(`/cars/${car.id}`)

  CarModel.parse(JsonApiResponse.parse(await found.json()).data)

  // Encode a make filter as JSON in a query parameter for the list route.
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
  // DELETE removes the saved car.
  await app.request(`/cars/${car.id}`, { method: 'DELETE' })
} finally {
  // Close the app's controllers, then release the backend borrowed by the app.
  app.close()
  backend.close()
}
