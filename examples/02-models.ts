import { z } from 'zod'

import { Collection, Hedra, Resource } from '#hedra.ts'

// Extend shared resource metadata with the car's attributes.
const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()

hedra.get('/health', (context) => context.text('Hello Hedra!'))

// Registration constructs the controller and generates the collection's HTTP routes.
hedra.register(cars)

// See docs/collections.md for model, routing and controller responsibilities.
export { CarModel, cars }
export default hedra
