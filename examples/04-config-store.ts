import assert from 'node:assert/strict'

import { Config, ConfigStore, TenantChanges, TenantInput } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: ':memory:' })
const store = new ConfigStore({ config })

try {
  // Shared mutation schemas can prepare input before the store validates it again.
  const input = TenantInput.parse({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' })
  const tenant = await store.tenants.create(input)

  assert.equal(tenant.name, 'Acme')
  assert.equal(tenant.tenantDomain, 'acme.hedra.local')
  assert.deepEqual(await store.tenants.get(tenant.id), tenant)
  assert.deepEqual(await store.tenants.list({ tenantDomain: tenant.tenantDomain }), [tenant])

  const changes = TenantChanges.parse({ name: ' Acme Australia ' })
  const renamed = await store.tenants.update(tenant.id, changes)

  assert.equal(renamed?.name, 'Acme Australia')
  assert.equal(renamed?.tenantDomain, tenant.tenantDomain)
  assert.equal(TenantChanges.safeParse({ tenantDomain: tenant.tenantDomain }).success, false)
} finally {
  store.close()
}
