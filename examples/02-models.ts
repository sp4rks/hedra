import { z } from 'zod'

import { Collection, Hedra } from '#hedra.ts'

// One schema supplies each car's runtime validation and TypeScript type.
const CarModel = z.object({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()

// Registration attaches the collection to Hedra's shared SQLite database.
hedra.register(cars)

// Import cars to use its methods. See docs/collections.md for a complete example.
export { CarModel, cars }
export default hedra
