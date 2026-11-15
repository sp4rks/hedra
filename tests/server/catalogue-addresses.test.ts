import { expect, test } from 'bun:test'

import { Config, ConfigStore, Hedra, JsonApiResponse, SqliteBackend } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('catalogue REST item paths and links use canonical domains', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const app = new Hedra({ config: new Config(quiet), configDatastore: store })
  const headers = { host: 'deployment.hedra.local', 'content-type': 'application/json' }

  try {
    const created = await app.request('/tenants', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Acme', tenantDomain: ' ACME.HEDRA.LOCAL ' }),
    })
    const tenant = JsonApiResponse.parse(await created.json())

    expect(created.status).toBe(201)
    expect(tenant.links.self).toBe('http://localhost/tenants/acme.hedra.local')
    expect(created.headers.get('location')).toBe(tenant.links.self)
    const read = await app.request('/tenants/ACME.HEDRA.LOCAL', { headers })

    expect(read.status).toBe(200)
    expect(JsonApiResponse.parse(await read.json()).links.self).toBe(tenant.links.self)
    expect((await app.request(`/tenants/${tenant.data.id}`, { headers })).status).toBe(422)
    const environment = await app.request('/environments', {
      method: 'POST',
      headers: { ...headers, host: 'acme.hedra.local' },
      body: JSON.stringify({ name: 'Dev', environmentDomain: 'dev.acme.hedra.local' }),
    })

    expect(environment.status).toBe(201)
    const value = JsonApiResponse.parse(await environment.json())

    expect(value.links.self).toBe('http://localhost/environments/dev.acme.hedra.local')
    const changed = await app.request('/environments/DEV.ACME.HEDRA.LOCAL', {
      method: 'PATCH',
      headers: { ...headers, host: 'acme.hedra.local' },
      body: JSON.stringify({ name: 'Development' }),
    })

    expect(changed.status).toBe(200)
    expect(JsonApiResponse.parse(await changed.json()).links.self).toBe(value.links.self)
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})
