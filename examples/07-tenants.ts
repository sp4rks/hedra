// Manage tenant definitions through Hedra's built-in REST API.
// It uses the configuration catalogue directly, so tenants need no application collection.

import { Config, Hedra, JsonApiListResponse, JsonApiResponse, Tenant } from '#hedra.ts'

// Select in-memory SQLite for the configuration catalogue and suppress startup output.
const app = new Hedra({
  config: new Config({
    HEDRA_SERVER_SILENT_STARTUP: 'true',
    HEDRA_SERVER_LOG_LEVEL: 'silent',
    HEDRA_SQLITE_PATH: ':memory:',
  }),
})
// Supply the deployment API Host required by the tenant routes, even for in-process requests.
const headers = { host: 'deployment.hedra.local', 'content-type': 'application/json' }

try {
  // Create a tenant; its name and domain are normalised and its metadata is assigned.
  const created = await app.request('/tenants', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' }),
  })
  const tenant = Tenant.parse(JsonApiResponse.parse(await created.json()).data)
  const path = `/tenants/${tenant.id}`
  // Retrieve the tenant definition using its generated ID.
  const found = await app.request(path, { headers })

  Tenant.parse(JsonApiResponse.parse(await found.json()).data)

  // Select tenants by domain using a JSON equality filter in one query parameter.
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
  // Delete the tenant definition; this does not delete application records.
  await app.request(path, { method: 'DELETE', headers })
} finally {
  // Close the app and the configuration datastore it owns.
  app.close()
}
