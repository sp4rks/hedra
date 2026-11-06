import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Config, ConfigStore, Hedra, JsonApiResponse, Resource, SqliteBackend, Tenant } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('ConfigStore exposes tenant resource operations through the generic controller', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)
  const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

  try {
    const tenant = await config.tenants.create(TenantInput.parse({ name: ' Acme ' }))

    expect(Tenant.parse(tenant)).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: tenant.createdAt,
      name: 'Acme',
    })
    expect(await config.tenants.get(tenant.id)).toEqual(tenant)
    expect(await config.tenants.update(tenant.id, TenantInput.partial().parse({ name: ' New name ' }))).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: expect.any(String),
      name: 'New name',
    })
    expect(await config.tenants.replace(tenant.id, { name: 'Replacement' })).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: expect.any(String),
      name: 'Replacement',
    })
    const unchecked = await config.tenants.create({ name: ' ' })

    expect(unchecked).toEqual({
      id: unchecked.id,
      createdAt: unchecked.createdAt,
      updatedAt: unchecked.createdAt,
      name: ' ',
    })
    expect(await config.tenants.list()).toEqual([
      { id: tenant.id, createdAt: tenant.createdAt, updatedAt: expect.any(String), name: 'Replacement' },
      unchecked,
    ])
    expect(await config.tenants.delete(tenant.id)).toBe(true)
    expect(await config.tenants.get(tenant.id)).toBeNull()
  } finally {
    backend.close()
  }
})

test('ConfigStore instances share tenant storage and remain separate from app resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore(backend)
  const second = new ConfigStore(backend)
  const app = new Hedra({ config: new Config(quiet), backend })
  const Car = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', Car)

  try {
    app.register(cars)
    app.post('/manual/cars', async (context) =>
      context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
    )
    const tenant = await first.tenants.create({ name: 'Acme' })
    const car = Car.parse(
      JsonApiResponse.parse(await (await app.request('/manual/cars', { method: 'POST' })).json()).data,
    )

    expect(await second.tenants.list()).toEqual([tenant])
    expect(await backend.select('cars')).toEqual([car])
  } finally {
    app.close()
    backend.close()
  }
})

test('application registration rejects the reserved tenant table without changing tenants', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)
  const app = new Hedra({ config: new Config(quiet), backend })

  try {
    const tenant = await config.tenants.create({ name: 'Acme' })
    const collection = new Collection('hedra_config_tenants', Resource.extend({ name: z.string() }))

    expect(() => app.register(collection)).toThrow('reserved')
    expect(await config.tenants.list()).toEqual([tenant])
    expect(() => collection.controller).toThrow('registered')
  } finally {
    app.close()
    backend.close()
  }
})

test('closing a shared backend ends access for every store using it', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)
  const app = new Hedra({ config: new Config(quiet), backend })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  app.register(cars)
  app.post('/manual/cars', async (context) =>
    context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
  )
  app.onError((_error, context) => context.text('closed', 500))
  backend.close()

  try {
    await expect(config.tenants.create({ name: 'Acme' })).rejects.toThrow()
    expect((await app.request('/manual/cars', { method: 'POST' })).status).toBe(500)
  } finally {
    app.close()
  }
})
