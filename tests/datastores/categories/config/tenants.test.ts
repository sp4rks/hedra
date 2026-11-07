import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConfigStore, SqliteBackend } from '#hedra.ts'

test('tenant domains are unique across stores, including concurrent creates', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore({ backend })
  const second = new ConfigStore({ backend })

  try {
    const results = await Promise.allSettled([
      first.tenants.create({ name: 'Acme', tenantDomain: ' Acme.Hedra.Local ' }),
      second.tenants.create({ name: 'Other', tenantDomain: 'acme.hedra.local' }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((result) => result.status === 'rejected')

    expect(rejected).toMatchObject({ status: 'rejected', reason: { status: 409 } })
    const tenants = await first.tenants.list()

    expect(tenants).toHaveLength(1)
    const original = tenants[0]

    if (!original) throw new Error('Tenant was not created')
    expect(original.tenantDomain).toBe('acme.hedra.local')
    expect(await first.tenants.delete(original.id)).toBe(true)
    const recreated = await second.tenants.create({ name: 'New', tenantDomain: 'acme.hedra.local' })

    expect(recreated.id).not.toBe(original.id)
  } finally {
    first.close()
    second.close()
    backend.close()
  }
})

test('tenant updates and replacements validate data and preserve the domain', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })

  try {
    const original = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    await expect(store.tenants.update(original.id, { tenantDomain: original.tenantDomain })).rejects.toMatchObject({
      status: 422,
    })
    await expect(store.tenants.update(original.id, { name: ' ' })).rejects.toMatchObject({ status: 422 })
    await expect(
      store.tenants.update(original.id, { id: crypto.randomUUID() } as unknown as { name: string }),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local', id: crypto.randomUUID() } as never),
    ).rejects.toMatchObject({ status: 422 })
    await expect(
      store.tenants.replace(original.id, { name: 'Changed', tenantDomain: 'other.hedra.local' }),
    ).rejects.toMatchObject({ status: 422 })
    expect(await store.tenants.get(original.id)).toEqual(original)
    const renamed = await store.tenants.update(original.id, { name: ' New name ' })

    expect(renamed).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      name: 'New name',
      tenantDomain: original.tenantDomain,
    })
    expect(
      await store.tenants.replace(original.id, { name: ' Replacement ', tenantDomain: original.tenantDomain }),
    ).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      name: 'Replacement',
      tenantDomain: original.tenantDomain,
    })
    expect(await store.tenants.update(crypto.randomUUID(), { name: 'Missing' })).toBeNull()
    expect(
      await store.tenants.replace(crypto.randomUUID(), { name: 'Missing', tenantDomain: 'missing.hedra.local' }),
    ).toBeNull()
  } finally {
    store.close()
    backend.close()
  }
})

test('tenant uniqueness holds across independent SQLite connections', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-tenant-unique-'))
  const path = join(dir, 'db.sqlite')
  const firstBackend = new SqliteBackend(path)
  const secondBackend = new SqliteBackend(path)
  const first = new ConfigStore({ backend: firstBackend })
  const second = new ConfigStore({ backend: secondBackend })

  try {
    const tenant = await first.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    await expect(second.tenants.create({ name: 'Copy', tenantDomain: 'ACME.HEDRA.LOCAL' })).rejects.toMatchObject({
      status: 409,
    })
    expect(await second.tenants.list()).toEqual([tenant])
  } finally {
    first.close()
    second.close()
    firstBackend.close()
    secondBackend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
