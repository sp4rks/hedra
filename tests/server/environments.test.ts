import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Config, ConfigStore, Hedra, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('application CRUD and scoped handlers require provisioned scope and isolate every mutation', async () => {
  const backend = new SqliteBackend(':memory:')
  const configBackend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend: configBackend })
  const app = new Hedra({ config: new Config(quiet), backend, configDatastore: store })
  const Widget = Resource.extend({ name: z.string() })
  const widgets = new Collection('widgets', Widget)
  const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
  const dev = await store.environments.create(tenant.tenantDomain, {
    name: 'Dev',
    environmentDomain: 'dev.acme.hedra.local',
  })
  const prod = await store.environments.create(tenant.tenantDomain, {
    name: 'Prod',
    environmentDomain: 'prod.acme.hedra.local',
  })
  const request = (path: string, host: string, method = 'GET', body?: unknown) =>
    app.request(path, {
      method,
      headers: { host, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  try {
    app.register(widgets)
    app.scoped.get('/context', (context, scope) => context.json(scope))
    expect((await app.request('/widgets')).status).toBe(412)
    expect((await request('/widgets', 'missing.acme.hedra.local')).status).toBe(404)
    expect(
      (
        await request('/widgets', dev.environmentDomain, 'POST', {
          name: 'One',
          environmentDomain: prod.environmentDomain,
        })
      ).status,
    ).toBe(422)
    const created = await request('/widgets', dev.environmentDomain, 'POST', { name: 'One' })
    const record = JsonApiResponse.parse(await created.json()).data

    expect(created.status).toBe(201)
    expect(record.environmentDomain).toBe(dev.environmentDomain)
    expect((await request(`/widgets/${record.id}`, prod.environmentDomain)).status).toBe(404)
    expect((await request(`/widgets/${record.id}`, prod.environmentDomain, 'PATCH', { name: 'Stolen' })).status).toBe(
      404,
    )
    expect((await request(`/widgets/${record.id}`, prod.environmentDomain, 'DELETE')).status).toBe(404)
    expect(
      (
        await request(
          `/widgets?filter=${encodeURIComponent(JSON.stringify({ environmentDomain: prod.environmentDomain }))}`,
          dev.environmentDomain,
        )
      ).status,
    ).toBe(422)
    expect((await request('/context', dev.environmentDomain)).status).toBe(200)
    await store.environments.delete(tenant.tenantDomain, dev.id)
    expect((await request('/widgets', dev.environmentDomain)).status).toBe(404)
    expect((await request('/context', dev.environmentDomain)).status).toBe(404)
    expect(await backend.select('widgets')).toHaveLength(1)
  } finally {
    app.close()
    store.close()
    backend.close()
    configBackend.close()
  }
})

test('tenant hosts manage environment CRUD while deleted domains stay reserved', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), configDatastore: store })
  const call = (path: string, host: string, method = 'GET', body?: unknown) =>
    app.request(path, {
      method,
      headers: { host, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const other = await store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local' })
    const create = await call('/environments', tenant.tenantDomain, 'POST', {
      name: ' Development ',
      environmentDomain: ' DEV.ACME.HEDRA.LOCAL ',
    })
    const environment = JsonApiResponse.parse(await create.json()).data
    const path = `/environments/${environment.id}`

    expect(create.status).toBe(201)
    expect(environment).toMatchObject({
      name: 'Development',
      tenantDomain: tenant.tenantDomain,
      environmentDomain: 'dev.acme.hedra.local',
    })
    expect((await call(path, `${tenant.tenantDomain.toUpperCase()}:3000`)).status).toBe(200)
    expect(
      (await call(`/environments?filter=${encodeURIComponent('{"name":" Development "}')}`, tenant.tenantDomain))
        .status,
    ).toBe(200)
    expect((await call(path, other.tenantDomain)).status).toBe(404)
    expect((await call(path, other.tenantDomain, 'PATCH', { name: 'Steal' })).status).toBe(404)
    expect((await call(path, other.tenantDomain, 'DELETE')).status).toBe(404)
    expect((await call('/environments/not-a-uuid', tenant.tenantDomain)).status).toBe(422)
    expect(
      (
        await call('/environments', tenant.tenantDomain, 'POST', {
          name: 'Bad',
          environmentDomain: 'deep.dev.acme.hedra.local',
        })
      ).status,
    ).toBe(422)
    expect(
      (
        await call('/environments', tenant.tenantDomain, 'POST', {
          name: 'Bad',
          environmentDomain: 'elsewhere.other.hedra.local',
          tenantDomain: other.tenantDomain,
        })
      ).status,
    ).toBe(422)
    expect(
      (await call(path, tenant.tenantDomain, 'PATCH', { environmentDomain: 'different.acme.hedra.local' })).status,
    ).toBe(422)
    expect((await call(path, tenant.tenantDomain, 'PATCH', { name: 'Production' })).status).toBe(200)
    expect((await call(`/tenants/${tenant.id}`, 'deployment.hedra.local', 'DELETE')).status).toBe(409)
    expect((await call(path, tenant.tenantDomain, 'DELETE')).status).toBe(204)
    expect((await call(path, tenant.tenantDomain)).status).toBe(404)
    expect((await call(path, tenant.tenantDomain, 'DELETE')).status).toBe(404)
    expect(
      (
        await call('/environments', tenant.tenantDomain, 'POST', {
          name: 'Reuse',
          environmentDomain: environment.environmentDomain,
        })
      ).status,
    ).toBe(409)
    expect((await call(`/tenants/${tenant.id}`, 'deployment.hedra.local', 'DELETE')).status).toBe(204)
    expect((await call('/environments', tenant.tenantDomain)).status).toBe(404)

    for (const host of [
      'hedra.local',
      'deployment.hedra.local',
      'dev.other.hedra.local',
      'other.hedra.local:bad',
      'other.hedra.local:99999',
      'evilmulti21.local',
    ]) {
      expect((await call('/environments', host, 'POST', {})).status).toBe(412)
    }
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})
