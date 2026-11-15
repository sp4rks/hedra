import { expect, test } from 'bun:test'

import type { Backend, DatabaseRecord } from '#hedra.ts'
import { ConfigStore, SqliteBackend } from '#hedra.ts'

/** Removes the marker in an injected backend result while its real write remains transactional. */
function undeleted(record: DatabaseRecord): DatabaseRecord {
  const value = { ...record }

  delete value.deletedAt

  return value
}

test('catalogue deletions reject missing or invalid backend results and roll back their markers', async () => {
  const backend = new SqliteBackend(':memory:')
  let result: (record: DatabaseRecord) => DatabaseRecord | null = (record) => record
  const injected: Backend = {
    ensureIndexes: backend.ensureIndexes.bind(backend),
    insert: backend.insert.bind(backend),
    select: backend.select.bind(backend),
    update: backend.update.bind(backend),
    delete: backend.delete.bind(backend),
    transaction: (work) =>
      backend.transaction((transaction) =>
        work({
          ...transaction,
          update: (...args) => {
            const written = transaction.update(...args)

            return written === null ? null : result(written)
          },
        }),
      ),
  }
  const store = new ConfigStore({ backend: injected })
  const failures = [
    () => null,
    undeleted,
    (record: DatabaseRecord) => ({ ...record, deletedAt: 'invalid' }),
    (record: DatabaseRecord) => ({ ...record, id: crypto.randomUUID() }),
    (record: DatabaseRecord) => ({ ...record, tenantDomain: 'other.hedra.local' }),
  ]

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const environment = await store.environments.create(tenant.tenantDomain, {
      name: 'Dev',
      environmentDomain: 'dev.acme.hedra.local',
    })

    for (const failure of failures) {
      result = failure
      await expect(store.environments.delete(tenant.tenantDomain, environment.environmentDomain)).rejects.toMatchObject(
        {
          status: 500,
        },
      )
      expect(await store.environments.get(tenant.tenantDomain, environment.environmentDomain)).toEqual(environment)
    }
    result = (record) => record
    expect(await store.environments.delete(tenant.tenantDomain, environment.environmentDomain)).toBe(true)

    for (const failure of failures) {
      result = failure
      await expect(store.tenants.delete(tenant.tenantDomain)).rejects.toMatchObject({ status: 500 })
      expect(await store.tenants.get(tenant.tenantDomain)).toEqual(tenant)
    }
  } finally {
    store.close()
    backend.close()
  }
})
