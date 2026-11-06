import assert from 'node:assert/strict'
import { z } from 'zod'

import { Controller, Resource, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const CreateCar = CarModel.omit({ id: true }).strict()

const backend = new SqliteBackend(':memory:')
const cars = new Controller<CarModel>('cars', backend)

try {
  const input = CreateCar.parse({ make: 'Toyota', model: 'Corolla', year: 2024 })
  const car: CarModel = await cars.create(input)

  assert.deepEqual(await cars.get(car.id), car)
  assert.deepEqual(await cars.update(car.id, { year: 2025 }), { ...car, year: 2025 })
} finally {
  backend.close()
}
