import { Config, Hedra, JsonApiListResponse, JsonApiResponse, Tenant } from '#hedra.ts'

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
  const tenant = Tenant.parse(JsonApiResponse.parse(await created.json()).data)
  const path = `/tenants/${tenant.id}`
  const found = await app.request(path, { headers })

  Tenant.parse(JsonApiResponse.parse(await found.json()).data)

  // Filters are JSON scalar equality criteria, encoded as one query parameter.
  const query = new URLSearchParams({ filter: JSON.stringify({ tenantDomain: tenant.tenantDomain }) })
  const listed = await app.request(`/tenants?${query}`, { headers })

  JsonApiListResponse.parse(await listed.json())

  // A name update preserves the domain, ID and creation timestamp.
  const renamed = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name: 'Acme Australia' }),
  })

  Tenant.parse(JsonApiResponse.parse(await renamed.json()).data)
  await app.request(path, { method: 'DELETE', headers })
} finally {
  app.close()
}
