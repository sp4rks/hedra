import assert from 'node:assert/strict'

import { Config, Hedra, Tenant } from '#hedra.ts'

const app = new Hedra({
  config: new Config({
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SERVER_LOG_LEVEL: 'silent',
    HEDRA_SQLITE_PATH: ':memory:',
  }),
})
// In-process requests supply Host explicitly, just as the HTTP server receives it.
const headers = { host: 'deployment.hedra.local', 'content-type': 'application/json' }

try {
  // Tenant routes are built in and use the configuration datastore.
  const created = await app.request('/tenants', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' }),
  })

  assert.equal(created.status, 201)
  const envelope = (await created.json()) as { data: unknown; links: { self: string } }
  const tenant = Tenant.parse(envelope.data)

  assert.equal(tenant.name, 'Acme')
  assert.equal(tenant.tenantDomain, 'acme.hedra.local')
  assert.equal(created.headers.get('location'), envelope.links.self)
  assert.deepEqual(await app.configDatastore.tenants.get(tenant.id), tenant)

  const path = `/tenants/${tenant.id}`
  const found = await app.request(path, { headers })

  assert.equal(found.status, 200)
  assert.deepEqual(((await found.json()) as { data: unknown }).data, tenant)

  // Filters are JSON scalar equality criteria, encoded as one query parameter.
  const query = new URLSearchParams({ filter: JSON.stringify({ tenantDomain: tenant.tenantDomain }) })
  const listed = await app.request(`/tenants?${query}`, { headers })

  assert.equal(listed.status, 200)
  assert.deepEqual(((await listed.json()) as { data: unknown[] }).data, [tenant])

  const renamed = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: 'Acme Australia' }),
  })

  assert.equal(renamed.status, 200)
  const updated = Tenant.parse(((await renamed.json()) as { data: unknown }).data)

  assert.equal(updated.name, 'Acme Australia')
  assert.equal(updated.tenantDomain, tenant.tenantDomain)
  assert.equal(updated.createdAt, tenant.createdAt)

  // A domain is fixed for the tenant's lifetime, even when PATCH repeats its value.
  const rejected = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ tenantDomain: tenant.tenantDomain }),
  })

  assert.equal(rejected.status, 422)
  assert.equal((await app.request('/tenants', { headers: { host: 'acme.hedra.local' } })).status, 412)
  assert.equal((await app.request(path, { method: 'DELETE', headers })).status, 204)
  assert.equal((await app.request(path, { headers })).status, 404)
} finally {
  app.close()
}
