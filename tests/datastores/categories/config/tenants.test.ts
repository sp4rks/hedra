import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigDatastore } from '#hedra.ts'
import { ConfigStore, SqliteBackend } from '#hedra.ts'

test('tenant get rejects stored data that fails the complete Tenant model', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const timestamp = '2026-01-01T00:00:00.000Z'

  try {
    const invalid: Record<string, string | number | boolean>[] = [
      { name: 42, tenantDomain: 'acme.hedra.local' },
      { name: ' ', tenantDomain: 'acme.hedra.local' },
      { name: 'Acme' },
      { name: 'Acme', tenantDomain: 'not a domain' },
      { name: 'Acme', tenantDomain: 'acme.hedra.local', extra: true },
    ]

    for (const attributes of invalid) {
      const id = crypto.randomUUID()

      await backend.insert('hedra_config_tenants', { id, createdAt: timestamp, updatedAt: timestamp, ...attributes })
      await expect(store.tenants.get(id)).rejects.toMatchObject({ name: 'OutputValidationError', status: 500 })
    }
  } finally {
    store.close()
    backend.close()
  }
})

test('tenant list rejects the whole result when a selected tenant is invalid', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const timestamp = '2026-01-01T00:00:00.000Z'

  try {
    const valid = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    await backend.insert('hedra_config_tenants', {
      id: crypto.randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      name: 42,
      tenantDomain: 'other.hedra.local',
    })
    await expect(store.tenants.list()).rejects.toMatchObject({ name: 'OutputValidationError', status: 500 })
    expect(await store.tenants.list({ tenantDomain: 'acme.hedra.local' })).toEqual([valid])
  } finally {
    store.close()
    backend.close()
  }
})

test('tenant reads return parsed values while retaining filters, ordering and absence semantics', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-01T00:00:00.000Z'
  const canonical = {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    name: 'Acme',
    tenantDomain: 'acme.hedra.local',
  }

  try {
    expect(await store.tenants.get(id)).toBeNull()
    expect(await store.tenants.list()).toEqual([])
    await backend.insert('hedra_config_tenants', {
      ...canonical,
      name: ' Acme ',
      tenantDomain: ' ACME.HEDRA.LOCAL ',
    })
    const other = await store.tenants.create({ name: 'Other', tenantDomain: 'other.hedra.local' })

    expect(await store.tenants.get(id)).toEqual(canonical)
    expect(await store.tenants.list()).toEqual([canonical, other])
    expect(await store.tenants.list({ tenantDomain: ' ACME.HEDRA.LOCAL ' })).toEqual([canonical])
    expect(await store.tenants.list({ tenantDomain: 'acme.hedra.local' })).toEqual([])
  } finally {
    store.close()
    backend.close()
  }
})

test('tenant operations accept structural inputs and reject forbidden fields at runtime', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const catalogue: ConfigDatastore = store

  try {
    const input = { name: 'Acme', tenantDomain: 'acme.hedra.local' }
    const tenant = await store.tenants.create(input)
    const withMetadata = { ...input, id: crypto.randomUUID() }
    const domainChange = { name: 'Changed', tenantDomain: input.tenantDomain }

    await expect(store.tenants.create(withMetadata)).rejects.toMatchObject({ status: 422 })
    await expect(catalogue.tenants.create(withMetadata)).rejects.toMatchObject({ status: 422 })
    await expect(store.tenants.replace(tenant.id, withMetadata)).rejects.toMatchObject({ status: 422 })
    await expect(catalogue.tenants.replace(tenant.id, withMetadata)).rejects.toMatchObject({ status: 422 })
    await expect(store.tenants.update(tenant.id, domainChange)).rejects.toMatchObject({ status: 422 })
    await expect(catalogue.tenants.update(tenant.id, domainChange)).rejects.toMatchObject({ status: 422 })
    // @ts-expect-error Object literals cannot include managed metadata, even with an undefined value.
    await expect(store.tenants.create({ ...input, id: undefined })).rejects.toMatchObject({ status: 422 })
    // @ts-expect-error Object literals cannot include a domain change, even with an undefined value.
    await expect(store.tenants.update(tenant.id, { name: 'Changed', tenantDomain: undefined })).rejects.toMatchObject({
      status: 422,
    })
    expect(await catalogue.tenants.update(tenant.id, { name: 'New name' })).toMatchObject({ name: 'New name' })
  } finally {
    store.close()
    backend.close()
  }
})

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

    // @ts-expect-error Runtime validation must also reject a forbidden domain field.
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
