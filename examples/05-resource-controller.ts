import assert from 'node:assert/strict'
import { z } from 'zod'

import { Collection, Controller, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

class CarController extends Controller<typeof CarModel> {
  /** Changes the year through the normal resource validation. */
  async setYear(id: string, year: number) {
    return this.update(id, { year })
  }
}

const backend = new SqliteBackend(':memory:')
const app = new Hedra({
  backend,
  env: { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' },
})
const cars = new Collection('cars', CarModel, CarController)

try {
  app.register(cars)
  const car: CarModel = await cars.controller.create({ make: 'Toyota', model: 'Corolla', year: 2024 })

  assert.deepEqual(await cars.controller.get(car.id), car)
  assert.deepEqual(await cars.controller.setYear(car.id, 2025), { ...car, year: 2025 })
  assert.equal(cars.endpoint, '/cars')
} finally {
  app.close()
  backend.close()
}
