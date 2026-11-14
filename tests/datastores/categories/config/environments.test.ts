import { expect, test } from 'bun:test'

import { ConflictError, InputValidationError, RecordNotFoundError, UniqueViolationError } from '#errors'
import { ConfigStore, SqliteBackend } from '#hedra.ts'

test('catalogue operations provision environments and permanently reserve deleted domains', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const tenantDomain = 'acme.hedra.local'
  const environmentDomain = 'dev.acme.hedra.local'

  try {
    await expect(store.environments.create(tenantDomain, { name: 'Dev', environmentDomain })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    )
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain })
    const environment = await store.environments.create(tenantDomain, {
      name: 'Dev',
      environmentDomain: ' DEV.ACME.HEDRA.LOCAL ',
    })

    expect(environment).toMatchObject({ name: 'Dev', tenantDomain, environmentDomain })
    expect(await store.environments.list(tenantDomain)).toEqual([environment])
    await expect(store.tenants.delete(tenant.id)).rejects.toBeInstanceOf(ConflictError)
    await expect(
      store.environments.update(tenantDomain, environment.id, { environmentDomain } as never),
    ).rejects.toBeInstanceOf(InputValidationError)
    expect(await store.environments.update(tenantDomain, environment.id, { name: 'Development' })).toMatchObject({
      name: 'Development',
    })
    expect(await store.environments.delete(tenantDomain, environment.id)).toBe(true)
    expect(await store.environments.get(tenantDomain, environment.id)).toBeNull()
    expect(await store.environments.list(tenantDomain)).toEqual([])
    await expect(
      store.environments.create(tenantDomain, { name: 'Replacement', environmentDomain }),
    ).rejects.toBeInstanceOf(UniqueViolationError)
    expect(await store.tenants.delete(tenant.id)).toBe(true)
    expect(await store.tenants.get(tenant.id)).toBeNull()
    expect(await store.tenants.list()).toEqual([])
    await expect(store.tenants.create({ name: 'Replacement', tenantDomain })).rejects.toBeInstanceOf(
      UniqueViolationError,
    )
    expect(await store.tenants.delete(tenant.id)).toBe(false)
  } finally {
    store.close()
    backend.close()
  }
})

test('environment operations validate stored relationships and preserve immutable replacements', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const tenantDomain = 'acme.hedra.local'

  try {
    await store.tenants.create({ name: 'Acme', tenantDomain })
    const original = await store.environments.create(tenantDomain, {
      name: 'Dev',
      environmentDomain: `dev.${tenantDomain}`,
    })
    const replaced = await store.environments.replace(tenantDomain, original.id, {
      name: 'Development',
      environmentDomain: original.environmentDomain,
    })

    if (!replaced) throw new Error('Environment was not replaced')
    expect(replaced).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      name: 'Development',
      environmentDomain: original.environmentDomain,
    })
    await expect(
      store.environments.replace(tenantDomain, original.id, {
        name: 'Moved',
        environmentDomain: `prod.${tenantDomain}`,
      }),
    ).rejects.toMatchObject({ status: 422 })
    expect(await store.environments.get(tenantDomain, original.id)).toEqual(replaced)
    const malformed = { ...original, id: crypto.randomUUID(), environmentDomain: 'dev.other.hedra.local' }

    await backend.insert('hedra_config_environments', malformed)
    await expect(store.environments.get(tenantDomain, malformed.id)).rejects.toMatchObject({ status: 500 })
    await expect(store.environments.list(tenantDomain)).rejects.toMatchObject({ status: 500 })
    expect(await store.environments.list(tenantDomain, { environmentDomain: original.environmentDomain })).toEqual([
      replaced,
    ])
  } finally {
    store.close()
    backend.close()
  }
})
