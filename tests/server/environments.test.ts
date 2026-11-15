import { expect, test } from 'bun:test'
import { z } from 'zod'

import {
  Config,
  ConfigStore,
  Hedra,
  JsonApiListResponse,
  JsonApiResponse,
  RequestScope,
  Resource,
  SqliteBackend,
} from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('application CRUD and scoped handlers require provisioned scope and isolate every mutation', async () => {
  const backend = new SqliteBackend(':memory:')
  const configBackend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend: configBackend })
  const app = new Hedra({ config: new Config(quiet), backend, configDatastore: store })
  const Widget = Resource.extend({ name: z.string() })
  const widgets = Widget.meta({ name: 'widgets' })
  const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
  const dev = await store.environments.create(tenant.tenantDomain, {
    name: 'Dev',
    environmentDomain: 'dev.acme.hedra.local',
  })
  const prod = await store.environments.create(tenant.tenantDomain, {
    name: 'Prod',
    environmentDomain: 'prod.acme.hedra.local',
  })
  const otherTenant = await store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local' })
  const otherEnvironment = await store.environments.create(otherTenant.tenantDomain, {
    name: 'Dev',
    environmentDomain: 'dev.other.hedra.local',
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
    const production = await request('/widgets', prod.environmentDomain, 'POST', { name: 'Production' })
    const other = await request('/widgets', otherEnvironment.environmentDomain, 'POST', { name: 'Other tenant' })
    const scenarios = [
      { scope: { tenant, environment: dev }, record },
      { scope: { tenant, environment: prod }, record: JsonApiResponse.parse(await production.json()).data },
      {
        scope: { tenant: otherTenant, environment: otherEnvironment },
        record: JsonApiResponse.parse(await other.json()).data,
      },
    ]

    expect(production.status).toBe(201)
    expect(other.status).toBe(201)

    for (const scenario of scenarios) {
      const list = await request('/widgets', scenario.scope.environment.environmentDomain)

      expect(list.status).toBe(200)
      expect(JsonApiListResponse.parse(await list.json()).data).toEqual([scenario.record])

      for (const outsider of scenarios.filter((value) => value !== scenario)) {
        const domain = outsider.scope.environment.environmentDomain
        const path = `/widgets/${scenario.record.id}`

        expect((await request(path, domain)).status).toBe(404)
        expect((await request(path, domain, 'PATCH', { name: 'Stolen' })).status).toBe(404)
        expect((await request(path, domain, 'DELETE')).status).toBe(404)
      }
      const unchanged = await request(`/widgets/${scenario.record.id}`, scenario.scope.environment.environmentDomain)

      expect(JsonApiResponse.parse(await unchanged.json()).data).toEqual(scenario.record)
    }
    const scopes = await Promise.all(
      scenarios.map(async (scenario) => {
        const response = await request('/context', scenario.scope.environment.environmentDomain)

        expect(response.status).toBe(200)

        return RequestScope.parse(await response.json())
      }),
    )

    expect(scopes).toEqual(scenarios.map((scenario) => scenario.scope))
    expect(
      (
        await request(
          `/widgets?filter=${encodeURIComponent(JSON.stringify({ environmentDomain: prod.environmentDomain }))}`,
          dev.environmentDomain,
        )
      ).status,
    ).toBe(422)
    await store.environments.delete(tenant.tenantDomain, dev.environmentDomain)
    expect((await request('/widgets', dev.environmentDomain)).status).toBe(404)
    expect((await request('/context', dev.environmentDomain)).status).toBe(404)
    expect(await backend.select('widgets')).toHaveLength(3)
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
    const path = `/environments/${environment.environmentDomain}`

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
    expect((await call(`/tenants/${tenant.tenantDomain}`, 'deployment.hedra.local', 'DELETE')).status).toBe(409)
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
    expect((await call(`/tenants/${tenant.tenantDomain}`, 'deployment.hedra.local', 'DELETE')).status).toBe(204)
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
