import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import type { ConfigDatastore } from '#hedra.ts'
import { Collection, Config, ConfigStore, Hedra, Resource, SqliteBackend } from '#hedra.ts'
import { provision, request } from '../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('Hedra accepts a structural configuration datastore and retains its identity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-datastore-'))
  const path = join(dir, 'unused.sqlite')
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const operations = store.tenants
  const configDatastore = {
    environments: store.environments,
    tenants: {
      create: operations.create.bind(operations),
      get: operations.get.bind(operations),
      list: operations.list.bind(operations),
      update: operations.update.bind(operations),
      replace: operations.replace.bind(operations),
      delete: operations.delete.bind(operations),
    },
  } satisfies ConfigDatastore
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }), configDatastore })

  try {
    expect(app.configDatastore).toBe(configDatastore)
    const tenant = await app.configDatastore.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    expect(await app.configDatastore.tenants.get(tenant.id)).toEqual(tenant)
    expect(existsSync(path)).toBe(false)
  } finally {
    app.close()
    store.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Hedra borrows a configuration datastore shared by apps', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const operations = store.tenants
  let closed = false
  const configDatastore = {
    environments: store.environments,
    tenants: operations,
    close: () => {
      closed = true
    },
  }
  const config = new Config(quiet)
  const first = new Hedra({ config, configDatastore })
  const second = new Hedra({ config, configDatastore })

  try {
    const tenant = await first.configDatastore.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    first.close()
    expect(closed).toBe(false)
    expect(await second.configDatastore.tenants.get(tenant.id)).toEqual(tenant)
    expect(await configDatastore.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    first.close()
    second.close()
    store.close()
    backend.close()
  }
})

test('Hedra creates configuration storage only when requested', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-datastore-'))
  const path = join(dir, 'nested', 'db.sqlite')
  const config = new Config({ ...quiet, HEDRA_SQLITE_PATH: path })
  const unused = new Hedra({ config })
  const app = new Hedra({ config })

  try {
    expect(existsSync(path)).toBe(false)
    unused.close()
    expect(existsSync(path)).toBe(false)
    const store = app.configDatastore

    expect(app.configDatastore).toBe(store)
    expect(existsSync(path)).toBe(true)
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    expect(await store.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    unused.close()
    app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Hedra closes its default configuration datastore and retains persisted tenants', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-datastore-'))
  const path = join(dir, 'db.sqlite')
  const unusedPath = join(dir, 'unused.sqlite')
  const config = new Config({ ...quiet, HEDRA_SQLITE_PATH: path })
  const app = new Hedra({ config })
  const reopened = new Hedra({ config })
  const unused = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: unusedPath }) })

  try {
    const operations = app.configDatastore.tenants
    const tenant = await operations.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    app.close()
    app.close()
    await expect(operations.get(tenant.id)).rejects.toThrow()
    expect(() => app.configDatastore).toThrow('Hedra is closed')
    expect(await reopened.configDatastore.tenants.get(tenant.id)).toEqual(tenant)
    unused.close()
    expect(() => unused.configDatastore).toThrow('Hedra is closed')
    expect(existsSync(unusedPath)).toBe(false)
  } finally {
    app.close()
    reopened.close()
    unused.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed default configuration datastore open can be retried', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-datastore-'))
  const path = join(dir, 'db.sqlite')
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }) })

  try {
    mkdirSync(path)
    expect(() => app.configDatastore).toThrow()
    rmSync(path, { recursive: true })
    const tenant = await app.configDatastore.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    expect(await app.configDatastore.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('configuration and application data use their own supplied datastores', async () => {
  const configBackend = new SqliteBackend(':memory:')
  const appBackend = new SqliteBackend(':memory:')
  const configDatastore = new ConfigStore({ backend: configBackend })
  const otherConfigDatastore = new ConfigStore({ backend: appBackend })
  const config = new Config(quiet)
  const app = new Hedra({ config, backend: appBackend, configDatastore })
  const observer = new Hedra({ config, backend: configBackend })
  const labels = new Collection('labels', Resource.extend({ name: z.string() }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(projects)
    observer.register(new Collection('projects', Resource.extend({ title: z.string() })))
    const tenant = await app.configDatastore.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const project = await request(app, '/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'First' }),
    })

    expect(project.status).toBe(201)
    const projectId = ((await project.json()) as { data: { id: string } }).data.id
    const label = await request(app, '/labels', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Urgent' }),
    })

    expect(label.status).toBe(201)
    const labelId = ((await label.json()) as { data: { id: string } }).data.id

    await app.associations.link(
      await provision(app),
      { collection: 'projects', id: projectId },
      { collection: 'labels', id: labelId },
    )
    expect(await app.associations.list(await provision(app), { collection: 'projects', id: projectId })).toHaveLength(1)
    expect(await configDatastore.tenants.get(tenant.id)).toEqual(tenant)
    expect(await otherConfigDatastore.tenants.list()).toEqual([])
    expect(((await (await request(observer, '/projects')).json()) as { data: unknown[] }).data).toEqual([])
  } finally {
    app.close()
    observer.close()
    configDatastore.close()
    otherConfigDatastore.close()
    configBackend.close()
    appBackend.close()
  }
})
