import { expect, test } from 'bun:test'

import { ConfigStore, SqliteBackend } from '#hedra.ts'

test('catalogue item operations use canonical domains while retaining UUID row identities', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    expect(await store.tenants.get(' ACME.HEDRA.LOCAL ')).toEqual(tenant)
    expect(await store.tenants.update(tenant.tenantDomain, { name: 'Renamed' })).toMatchObject({ id: tenant.id })
    await expect(store.tenants.get(tenant.id)).rejects.toMatchObject({ status: 422 })
  } finally {
    store.close()
    backend.close()
  }
})

test('environment domain addresses retain tenant scope through mutation and deletion', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const other = await store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local' })
    const environment = await store.environments.create(tenant.tenantDomain, {
      name: 'Dev',
      environmentDomain: 'dev.acme.hedra.local',
    })

    expect(await store.environments.get(' ACME.HEDRA.LOCAL ', ' DEV.ACME.HEDRA.LOCAL ')).toEqual(environment)
    expect(await store.environments.get(other.tenantDomain, environment.environmentDomain)).toBeNull()
    expect(
      await store.environments.update(other.tenantDomain, environment.environmentDomain, { name: 'Stolen' }),
    ).toBeNull()
    expect(await store.environments.delete(other.tenantDomain, environment.environmentDomain)).toBe(false)
    expect(
      await store.environments.update(tenant.tenantDomain, environment.environmentDomain, { name: 'Development' }),
    ).toMatchObject({ id: environment.id })
    expect(await store.environments.delete(tenant.tenantDomain, environment.environmentDomain)).toBe(true)
    expect(await store.environments.get(tenant.tenantDomain, environment.environmentDomain)).toBeNull()
    await expect(
      store.environments.create(tenant.tenantDomain, {
        name: 'Reuse',
        environmentDomain: environment.environmentDomain,
      }),
    ).rejects.toMatchObject({ status: 409 })
  } finally {
    store.close()
    backend.close()
  }
})
