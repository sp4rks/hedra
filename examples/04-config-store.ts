import assert from 'node:assert/strict'

import { ConfigStore, SqliteBackend, Tenant } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const config = new ConfigStore(backend)
const CreateTenant = Tenant.omit({ id: true, createdAt: true, updatedAt: true }).strict()

try {
  // Validate and normalise input before passing plain data to programmatic operations.
  const input = CreateTenant.parse({ name: ' Acme ' })
  const tenant = await config.tenants.create(input)

  assert.equal(tenant.name, 'Acme')
  assert.deepEqual(await config.tenants.get(tenant.id), tenant)
} finally {
  backend.close()
}
