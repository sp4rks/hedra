import { expect, test } from 'bun:test'

import { UniqueViolationError } from '#errors'
import { SqliteBackend } from '#hedra.ts'

test('SQLite indexes enforce unique fields while non-unique scope permits many resources', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.ensureIndexes('tenants', [{ field: 'tenantDomain', unique: true }])
    await backend.insert('tenants', { id: 'one', tenantDomain: 'acme.hedra.local' })
    await expect(backend.insert('tenants', { id: 'two', tenantDomain: 'acme.hedra.local' })).rejects.toBeInstanceOf(
      UniqueViolationError,
    )
    await backend.ensureIndexes('widgets', [{ field: 'environmentDomain', unique: false }])
    await backend.insert('widgets', { id: 'one', environmentDomain: 'dev.acme.hedra.local', value: true })
    await backend.insert('widgets', { id: 'two', environmentDomain: 'dev.acme.hedra.local', value: 1 })
    expect(await backend.select('widgets', { environmentDomain: 'dev.acme.hedra.local', value: true })).toHaveLength(1)
    expect(await backend.select('widgets', { environmentDomain: 'dev.acme.hedra.local', value: 1 })).toHaveLength(1)
    await backend.ensureIndexes('widgets', [{ field: 'environmentDomain', unique: false }])
  } finally {
    backend.close()
  }
})
