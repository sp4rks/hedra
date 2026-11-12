// Create, retrieve and rename a tenant through the configuration datastore.
// These operations enforce tenant rules without an HTTP request or a full Hedra app.

import { Config, ConfigStore, TenantChanges, TenantInput } from '#hedra.ts'

// Use in-memory SQLite so the example leaves no database file.
const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: ':memory:' })
const store = new ConfigStore({ config })

try {
  // Normalise the name and domain with the shared input schema before creating the tenant.
  const input = TenantInput.parse({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' })
  const tenant = await store.tenants.create(input)

  // Retrieve the tenant by ID, then select tenants matching its normalised domain.
  await store.tenants.get(tenant.id)
  await store.tenants.list({ tenantDomain: tenant.tenantDomain })

  // Prepare a name-only update; the tenant's domain is fixed after creation.
  const changes = TenantChanges.parse({ name: ' Acme Australia ' })

  // Save the new name while preserving the ID, domain and creation timestamp.
  await store.tenants.update(tenant.id, changes)
} finally {
  // Release the store's connection even if an operation fails.
  store.close()
}
