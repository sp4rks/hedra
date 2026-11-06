import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, ConfigStore, Hedra, Resource, SqliteBackend, Tenant } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('ConfigStore exposes tenant resource operations through the generic controller', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)

  try {
    const tenant = await config.tenants.create({ name: ' Acme ' })

    expect(Tenant.parse(tenant)).toEqual({ id: tenant.id, name: 'Acme' })
    expect(await config.tenants.get(tenant.id)).toEqual(tenant)
    expect(await config.tenants.update(tenant.id, { name: ' New name ' })).toEqual({ id: tenant.id, name: 'New name' })
    expect(await config.tenants.replace(tenant.id, { name: 'Replacement' })).toEqual({
      id: tenant.id,
      name: 'Replacement',
    })
    await expect(config.tenants.create({ name: ' ' })).rejects.toThrow()
    expect(await config.tenants.list()).toEqual([{ id: tenant.id, name: 'Replacement' }])
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
  const app = new Hedra({ env: quiet, backend })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  try {
    app.register(cars)
    const tenant = await first.tenants.create({ name: 'Acme' })
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(await second.tenants.list()).toEqual([tenant])
    expect(await cars.controller.list()).toEqual([car])
  } finally {
    app.close()
    backend.close()
  }
})

test('application registration rejects the reserved tenant table without changing tenants', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)
  const app = new Hedra({ env: quiet, backend })

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
  const app = new Hedra({ env: quiet, backend })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  app.register(cars)
  backend.close()

  try {
    await expect(config.tenants.create({ name: 'Acme' })).rejects.toThrow()
    await expect(cars.controller.create({ make: 'Toyota' })).rejects.toThrow()
  } finally {
    app.close()
  }
})
