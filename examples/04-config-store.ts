import assert from 'node:assert/strict'

import { ConfigStore, SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const config = new ConfigStore(backend)

try {
  const tenant = await config.tenants.create({
    name: ' Acme ',
  })

  assert.equal(tenant.name, 'Acme')
  assert.deepEqual(await config.tenants.get(tenant.id), tenant)
} finally {
  backend.close()
}
