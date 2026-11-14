import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { Collection, Config, ConfigStore, Hedra, JsonApiResponse, Resource, SqliteBackend, Tenant } from '#hedra.ts'
import { request } from '../../../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('ConfigStore uses supplied configuration to persist tenants', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-store-'))
  const config = new Config({ ...quiet, HEDRA_SQLITE_PATH: join(dir, 'db.sqlite') })
  const first = new ConfigStore({ config })
  let second: ConfigStore | undefined

  try {
    const tenant = await first.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    first.close()
    second = new ConfigStore({ config })
    expect(await second.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    first.close()
    second?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ConfigStore borrows its supplied backend even when the configured path is unusable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-store-'))
  const config = new Config({ ...quiet, HEDRA_SQLITE_PATH: dir })
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore({ config, backend })
  const second = new ConfigStore({ backend })
  const app = new Hedra({ config, backend, configDatastore: first })

  try {
    const tenant = await first.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    first.close()
    first.close()
    expect(await first.tenants.get(tenant.id)).toEqual(tenant)
    expect(await second.tenants.get(tenant.id)).toEqual(tenant)
    app.register(new Collection('cars', Resource.extend({ make: z.string() })))
    expect((await request(app, '/cars')).status).toBe(200)
  } finally {
    app.close()
    second.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ConfigStore accepts and borrows a directly supplied backend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-store-'))
  const backend = new SqliteBackend(':memory:')
  const previousPath = process.env.HEDRA_SQLITE_PATH
  const observer = new ConfigStore({ backend })
  let store: ConfigStore | undefined

  process.env.HEDRA_SQLITE_PATH = dir
  try {
    store = new ConfigStore(backend)
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    store.close()
    expect(await observer.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    if (previousPath === undefined) delete process.env.HEDRA_SQLITE_PATH
    else process.env.HEDRA_SQLITE_PATH = previousPath
    store?.close()
    observer.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ConfigStore exposes validated tenant resource operations', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore({ backend })
  const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

  try {
    const tenant = await config.tenants.create(TenantInput.parse({ name: ' Acme ', tenantDomain: 'acme.hedra.local' }))

    expect(Tenant.parse(tenant)).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: tenant.createdAt,
      name: 'Acme',
      tenantDomain: 'acme.hedra.local',
    })
    expect(await config.tenants.get(tenant.id)).toEqual(tenant)
    expect(await config.tenants.update(tenant.id, { name: ' New name ' })).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: expect.any(String),
      name: 'New name',
      tenantDomain: 'acme.hedra.local',
    })
    expect(await config.tenants.replace(tenant.id, { name: 'Replacement', tenantDomain: 'acme.hedra.local' })).toEqual({
      id: tenant.id,
      createdAt: tenant.createdAt,
      updatedAt: expect.any(String),
      name: 'Replacement',
      tenantDomain: 'acme.hedra.local',
    })
    await expect(config.tenants.create({ name: ' ', tenantDomain: 'other.hedra.local' })).rejects.toMatchObject({
      status: 422,
    })
    expect(await config.tenants.list()).toEqual([
      {
        id: tenant.id,
        createdAt: tenant.createdAt,
        updatedAt: expect.any(String),
        name: 'Replacement',
        tenantDomain: 'acme.hedra.local',
      },
    ])
    expect(await config.tenants.delete(tenant.id)).toBe(true)
    expect(await config.tenants.get(tenant.id)).toBeNull()
  } finally {
    backend.close()
  }
})

test('ConfigStore instances share tenant storage and remain separate from app resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore({ backend })
  const second = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), backend })
  const Car = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', Car)

  try {
    app.register(cars)
    app.scoped.post('/manual/cars', async (context) =>
      context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
    )
    const tenant = await first.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const car = Car.parse(
      JsonApiResponse.parse(await (await request(app, '/manual/cars', { method: 'POST' })).json()).data,
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
  const config = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), backend })

  try {
    const tenant = await config.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
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
  const config = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), backend })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  app.register(cars)
  app.scoped.post('/manual/cars', async (context) =>
    context.json(await cars.controller.create(context, cars, { make: 'Toyota' })),
  )
  app.onError((_error, context) => context.text('closed', 500))
  backend.close()

  try {
    await expect(config.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })).rejects.toThrow()
    expect((await request(app, '/manual/cars', { method: 'POST' })).status).toBe(500)
  } finally {
    app.close()
  }
})
