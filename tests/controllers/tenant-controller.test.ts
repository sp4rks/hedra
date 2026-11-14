import { expect, test } from 'bun:test'
import { Context, Hono } from 'hono'

import type { ConfigDatastore } from '#hedra.ts'
import { InputValidationError } from '#errors'
import { Collection, Config, ConfigStore, SqliteBackend, Tenant, TenantController } from '#hedra.ts'

test('all TenantController operations reject missing, malformed or different deployment hosts', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' })
  let datastoreCalls = 0
  const controller = new TenantController(config, (): ConfigDatastore => {
    datastoreCalls++

    return store
  })
  const collection = new Collection('tenants', Tenant)
  const app = new Hono()
  const id = crypto.randomUUID()

  app.get('/:action', async (context) => {
    const action = context.req.param('action')

    if (action === 'create')
      await controller.create(context, collection, { name: 'Acme', tenantDomain: 'acme.hedra.local' })
    if (action === 'id') await controller.id(context, collection, id)
    if (action === 'list') await controller.list(context, collection, context.req.url)
    if (action === 'update') await controller.update(context, collection, { name: 'Other' }, id)
    if (action === 'delete') await controller.delete(context, collection, id)

    return context.json({ ok: true })
  })
  app.onError((error, context) => context.json({ status: (error as { status?: number }).status }))

  try {
    for (const action of ['create', 'id', 'list', 'update', 'delete']) {
      for (const host of [
        undefined,
        'other.hedra.local',
        'deployment.hedra.local.evil',
        'deployment.hedra.local:bad',
        'deployment.hedra.local:65536',
      ]) {
        const requestHeaders: Record<string, string> = { 'x-forwarded-host': 'deployment.hedra.local' }

        if (host !== undefined) requestHeaders.host = host
        const response = await app.request(`http://deployment.hedra.local/${action}`, { headers: requestHeaders })

        expect(await response.json()).toEqual({ status: 412 })
      }
    }
    expect(datastoreCalls).toBe(0)
    const allowed = await app.request('http://deployment.hedra.local/list', {
      headers: { host: 'DEPLOYMENT.HEDRA.LOCAL:8080' },
    })

    expect(await allowed.json()).toEqual({ ok: true })
    expect(datastoreCalls).toBe(1)
  } finally {
    store.close()
    backend.close()
  }
})

test('direct tenant controller calls validate domains and protect server-owned metadata', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const controller = new TenantController(
    new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }),
    () => store,
  )
  const collection = new Collection('tenants', Tenant)
  const app = new Hono()

  app.post('/tenants', async (context) =>
    context.json(await controller.create(context, collection, await context.req.json())),
  )
  app.patch('/tenants/:id', async (context) =>
    context.json(await controller.update(context, collection, await context.req.json(), context.req.param('id'))),
  )
  app.onError((error, context) => context.json({ status: (error as { status?: number }).status }))
  const headers = { host: 'deployment.hedra.local', 'content-type': 'application/json' }

  try {
    const wrongDomain = await app.request('http://deployment.hedra.local/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Acme', tenantDomain: 'other.example' }),
    })

    expect(await wrongDomain.json()).toEqual({ status: 422 })
    const created = await app.request('http://deployment.hedra.local/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Acme', tenantDomain: 'acme.hedra.local', id: 'spoofed' }),
    })
    const tenant = Tenant.parse(((await created.json()) as { data: unknown }).data)

    expect(tenant.id).not.toBe('spoofed')
    const changed = await app.request(`http://deployment.hedra.local/tenants/${tenant.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ tenantDomain: tenant.tenantDomain }),
    })

    expect(await changed.json()).toEqual({ status: 422 })
    expect(await store.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    store.close()
    backend.close()
  }
})

test('direct tenant list filters reject inherited keys and accept declared domain fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const controller = new TenantController(
    new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }),
    () => store,
  )
  const collection = new Collection('tenants', Tenant)
  const url = 'http://deployment.hedra.local/tenants'
  const context = new Context(new Request(url, { headers: { host: 'deployment.hedra.local' } }))

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    for (const key of ['toString', 'constructor']) {
      await expect(controller.list(context, collection, url, { filter: { [key]: 'x' } })).rejects.toBeInstanceOf(
        InputValidationError,
      )
    }
    expect((await controller.list(context, collection, url, { filter: { name: ' Acme ' } })).data).toEqual([tenant])
  } finally {
    store.close()
    backend.close()
  }
})
