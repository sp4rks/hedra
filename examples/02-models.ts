// Turn a Zod model into a stored collection with a REST API.
// One schema supplies validation and TypeScript types; registration installs the CRUD routes.

import { z } from 'zod'

import { Collection, Hedra, Resource } from '#hedra.ts'

// Add car attributes to the shared ID and timestamps, then infer the type from that schema.
const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

// The collection name selects its storage table and /cars endpoint.
const cars = new Collection('cars', CarModel)
const hedra = new Hedra()

// Custom application routes can live alongside the generated collection routes.
hedra.get('/health', (context) => context.text('Hello Hedra!'))

// Provision a demo tenant and environment explicitly before serving its resources.
const tenantDomain = 'example.hedra.local'
const environmentDomain = 'dev.example.hedra.local'
const tenants = await hedra.configDatastore.tenants.list({ tenantDomain })

if (!tenants.length) await hedra.configDatastore.tenants.create({ name: 'Example', tenantDomain })
const environments = await hedra.configDatastore.environments.list(tenantDomain, { environmentDomain })

if (!environments.length)
  await hedra.configDatastore.environments.create(tenantDomain, { name: 'Development', environmentDomain })

// Send collection requests with Host: dev.example.hedra.local.
// Install create, read, list, update and delete routes backed by the collection's controller.
hedra.register(cars)

// Export the model and collection for application code, and the app for Bun to serve.
// See docs/collections.md for collection and controller responsibilities.
export { CarModel, cars }
export default hedra
