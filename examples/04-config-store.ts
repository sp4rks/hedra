import assert from 'node:assert/strict'

import { Config, ConfigStore, Tenant } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SQLITE_PATH: ':memory:' })
const store = new ConfigStore({ config })
const CreateTenant = Tenant.omit({ id: true, createdAt: true, updatedAt: true }).strict()

try {
  // Validate and normalise input before passing plain data to programmatic operations.
  const input = CreateTenant.parse({ name: ' Acme ' })
  const tenant = await store.tenants.create(input)

  assert.equal(tenant.name, 'Acme')
  assert.deepEqual(await store.tenants.get(tenant.id), tenant)
} finally {
  store.close()
}
