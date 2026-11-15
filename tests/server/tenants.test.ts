import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import type { ConfigDatastore } from '#hedra.ts'
import { Config, ConfigStore, Hedra, JsonApiResponse, Resource, SqliteBackend, Tenant } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { host: 'deployment.hedra.local', 'content-type': 'application/json' }

test('tenant HTTP reads redact invalid data from the default configuration store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-invalid-tenant-'))
  const path = join(dir, 'db.sqlite')
  const backend = new SqliteBackend(path)
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }) })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-01T00:00:00.000Z'

  try {
    await backend.insert('hedra_config_tenants', {
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      name: 42,
      tenantDomain: 'acme.hedra.local',
    })

    for (const target of ['/tenants', '/tenants/acme.hedra.local']) {
      const response = await app.request(`http://deployment.hedra.local${target}`, { headers })

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    }
  } finally {
    app.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tenant REST CRUD uses the configuration catalogue', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), configDatastore: store })

  try {
    const created = await app.request('http://deployment.hedra.local/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ', id: 'client-id' }),
    })
    const envelope = JsonApiResponse.parse(await created.json())
    const tenant = Tenant.parse(envelope.data)

    expect(created.status).toBe(201)
    expect(tenant).toMatchObject({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    expect(tenant.id).not.toBe('client-id')
    expect(envelope.links.self).toBe(`http://deployment.hedra.local/tenants/${tenant.tenantDomain}`)
    expect(created.headers.get('location')).toBe(envelope.links.self)
    expect(await store.tenants.get(tenant.tenantDomain)).toEqual(tenant)
    const other = await store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local' })
    const list = await app.request('http://deployment.hedra.local/tenants', { headers })

    expect(((await list.json()) as { data: unknown[] }).data).toEqual([tenant, other])
    const filter = encodeURIComponent(JSON.stringify({ tenantDomain: 'ACME.HEDRA.LOCAL' }))
    const filtered = await app.request(`http://deployment.hedra.local/tenants?filter=${filter}`, { headers })

    expect(((await filtered.json()) as { data: unknown[] }).data).toEqual([tenant])
    expect((await app.request(envelope.links.self, { headers })).status).toBe(200)
    const renamed = await app.request(envelope.links.self, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: ' New ' }),
    })

    expect(JsonApiResponse.parse(await renamed.json()).data).toMatchObject({
      id: tenant.id,
      createdAt: tenant.createdAt,
      tenantDomain: tenant.tenantDomain,
      name: 'New',
    })
    expect((await app.request(envelope.links.self, { method: 'DELETE', headers })).status).toBe(204)
    expect((await app.request(envelope.links.self, { headers })).status).toBe(404)
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})

test('tenant hosts are checked before input validation or opening the configuration store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-tenant-host-'))
  const path = join(dir, 'db.sqlite')
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }) })

  try {
    for (const [method, target] of [
      ['GET', '/tenants'],
      ['POST', '/tenants'],
      ['GET', '/tenants/acme.hedra.local'],
      ['PATCH', '/tenants/acme.hedra.local'],
      ['DELETE', '/tenants/acme.hedra.local'],
    ]) {
      for (const host of [undefined, 'tenant.hedra.local', 'deployment.hedra.local:65536']) {
        const requestHeaders: Record<string, string> = { 'x-forwarded-host': 'deployment.hedra.local' }

        if (host !== undefined) requestHeaders.host = host
        const response = await app.request(`http://deployment.hedra.local${target}`, {
          method,
          headers: requestHeaders,
        })

        expect(response.status).toBe(412)
      }
    }
    expect(existsSync(path)).toBe(false)
    const allowed = await app.request('http://deployment.hedra.local/tenants', {
      headers: { host: 'DEPLOYMENT.HEDRA.LOCAL:8080' },
    })

    expect(allowed.status).toBe(200)
    expect(existsSync(path)).toBe(true)
  } finally {
    app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tenant domains must be direct, unreserved subdomains of each app deployment', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const first = new Hedra({ config: new Config(quiet), configDatastore: store })
  const second = new Hedra({
    config: new Config({
      ...quiet,
      HEDRA_DEPLOYMENT_DOMAIN: 'other.example',
      HEDRA_DEPLOYMENT_API_DOMAIN: 'api.other.example',
    }),
    configDatastore: store,
  })
  const request = (app: Hedra, host: string, tenantDomain: string) =>
    app.request('http://localhost/tenants', {
      method: 'POST',
      headers: { host, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', tenantDomain }),
    })

  try {
    for (const domain of [
      'hedra.local',
      'deep.acme.hedra.local',
      'other.local',
      'evilhedra.local',
      'deployment.hedra.local',
      'docs.hedra.local',
    ]) {
      expect((await request(first, 'deployment.hedra.local', domain)).status).toBe(422)
    }
    expect((await request(first, 'deployment.hedra.local', 'acme.other.example')).status).toBe(422)
    expect((await request(second, 'api.other.example', 'acme.hedra.local')).status).toBe(422)
    expect((await request(second, 'api.other.example', ' ACME.OTHER.EXAMPLE ')).status).toBe(201)
    expect((await request(first, 'deployment.hedra.local', 'acme.hedra.local')).status).toBe(201)
  } finally {
    first.close()
    second.close()
    store.close()
    backend.close()
  }
})

test('tenant API rejects invalid mutations and duplicate domains without changing data', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), configDatastore: store })

  try {
    const original = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const path = `http://deployment.hedra.local/tenants/${original.tenantDomain}`
    const change = (body: unknown) => app.request(path, { method: 'PATCH', headers, body: JSON.stringify(body) })

    expect((await change({ tenantDomain: original.tenantDomain })).status).toBe(422)
    expect((await change({ tenantDomain: 'other.hedra.local' })).status).toBe(422)
    expect((await change({ name: '' })).status).toBe(422)
    expect((await change({ unknown: 'field' })).status).toBe(422)
    expect(await store.tenants.get(original.tenantDomain)).toEqual(original)
    const duplicate = await app.request('http://deployment.hedra.local/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Other', tenantDomain: ' ACME.HEDRA.LOCAL ' }),
    })

    expect(duplicate.status).toBe(409)
    expect(await store.tenants.list()).toEqual([original])
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})

test('reserved tenant collection names cannot be registered directly or through associations', () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const tenants = Resource.extend({ name: z.string() }).meta({ name: 'tenants' })
  const projects = Resource.extend({ name: z.string() }).meta({ name: 'projects' })

  try {
    expect(() => app.register(tenants)).toThrow('reserved')
    expect(() => app.register(projects, { associations: [tenants] })).toThrow('reserved')
  } finally {
    app.close()
    backend.close()
  }
})

test('HTTP routes use a structural borrowed datastore and reject use after close', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-tenant-injected-'))
  const path = join(dir, 'unused.sqlite')
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const operations = store.tenants
  const configDatastore: ConfigDatastore = {
    environments: store.environments,
    tenants: {
      create: operations.create.bind(operations),
      get: operations.get.bind(operations),
      list: operations.list.bind(operations),
      update: operations.update.bind(operations),
      replace: operations.replace.bind(operations),
      delete: operations.delete.bind(operations),
    },
  }
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }), configDatastore })

  try {
    expect(app.configDatastore).toBe(configDatastore)
    const response = await app.request('http://deployment.hedra.local/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Acme', tenantDomain: 'acme.hedra.local' }),
    })
    const tenant = Tenant.parse(JsonApiResponse.parse(await response.json()).data)

    expect(response.status).toBe(201)
    expect(existsSync(path)).toBe(false)
    app.close()
    expect((await app.request('http://deployment.hedra.local/tenants', { headers })).status).toBe(500)
    expect(await configDatastore.tenants.get(tenant.tenantDomain)).toEqual(tenant)
  } finally {
    app.close()
    store.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tenant routes validate requests and redact invalid or failed datastore responses', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const id = crypto.randomUUID()
  const configDatastore: ConfigDatastore = {
    environments: store.environments,
    tenants: {
      create: store.tenants.create.bind(store.tenants),
      get: async () => ({ id, name: 'missing domain' }) as Tenant,
      list: async () => {
        throw new Error('sensitive backend detail')
      },
      update: store.tenants.update.bind(store.tenants),
      replace: store.tenants.replace.bind(store.tenants),
      delete: store.tenants.delete.bind(store.tenants),
    },
  }
  const app = new Hedra({ config: new Config(quiet), configDatastore })

  try {
    const post = (body: string, requestHeaders: Record<string, string> = headers) =>
      app.request('http://deployment.hedra.local/tenants', { method: 'POST', headers: requestHeaders, body })

    expect((await post('{')).status).toBe(400)
    expect((await post('{}', { host: headers.host, 'content-type': 'text/plain' })).status).toBe(415)
    expect((await post(JSON.stringify({ name: 'Acme' }))).status).toBe(422)
    expect((await post(JSON.stringify({ name: 'Acme', tenantDomain: 'acme.hedra.local', extra: true }))).status).toBe(
      422,
    )
    expect((await app.request('http://deployment.hedra.local/tenants/not-a-uuid', { headers })).status).toBe(422)
    expect(
      (
        await app.request(`http://deployment.hedra.local/tenants?filter=${encodeURIComponent('{"unknown":"x"}')}`, {
          headers,
        })
      ).status,
    ).toBe(422)
    const invalid = await app.request('http://deployment.hedra.local/tenants/acme.hedra.local', { headers })
    const failed = await app.request('http://deployment.hedra.local/tenants', { headers })

    expect(invalid.status).toBe(500)
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('sensitive backend detail')
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})
