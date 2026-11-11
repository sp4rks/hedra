import { Config, ConfigStore, TenantChanges, TenantInput } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: ':memory:' })
const store = new ConfigStore({ config })

try {
  // Shared mutation schemas can prepare input before the store validates it again.
  const input = TenantInput.parse({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' })
  const tenant = await store.tenants.create(input)

  // Reads return the normalised name 'Acme' and domain 'acme.hedra.local'.
  await store.tenants.get(tenant.id)
  await store.tenants.list({ tenantDomain: tenant.tenantDomain })

  const changes = TenantChanges.parse({ name: ' Acme Australia ' })

  // Name updates preserve the tenant's immutable domain.
  await store.tenants.update(tenant.id, changes)
} finally {
  store.close()
}
