import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import { ConfigStore, SqliteBackend } from '#hedra.ts'

test('ConfigStore creates a tenant from normalized configuration', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)

  try {
    expect(await config.tenants.create({ id: ' acme ', name: ' Acme ' })).toEqual({ id: 'acme', name: 'Acme' })
  } finally {
    backend.close()
  }
})

test('ConfigStore rejects invalid tenant configuration before writing', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)

  try {
    for (const input of [
      {},
      { id: ' ', name: 'Acme' },
      { id: 'acme', name: ' ' },
      { id: 1, name: 'Acme' },
      { id: 'acme', name: 1 },
      { id: 'acme' },
      { name: 'Acme' },
    ]) {
      await expect(config.tenants.create(input as never)).rejects.toThrow(z.ZodError)
    }

    expect(await config.tenants.create({ id: 'acme', name: 'Acme' })).toEqual({ id: 'acme', name: 'Acme' })
  } finally {
    backend.close()
  }
})

test('ConfigStore rejects an existing normalized tenant ID', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)

  try {
    await config.tenants.create({ id: 'acme', name: 'Acme' })
    await expect(config.tenants.create({ id: ' acme ', name: 'Replacement' })).rejects.toThrow()
    expect(await config.tenants.create({ id: 'other', name: 'Other' })).toEqual({ id: 'other', name: 'Other' })
  } finally {
    backend.close()
  }
})

test('ConfigStore shares tenant storage through one backend', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore(backend)
  const second = new ConfigStore(backend)

  try {
    await first.tenants.create({ id: 'acme', name: 'Acme' })
    await expect(second.tenants.create({ id: 'acme', name: 'Replacement' })).rejects.toThrow()
  } finally {
    backend.close()
  }
})

test('SqliteBackend persists tenants after reopening a nested database path', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-store-'))
  const path = join(dir, 'nested', 'config.sqlite')
  let backend: SqliteBackend | undefined

  try {
    backend = new SqliteBackend(path)
    await new ConfigStore(backend).tenants.create({ id: 'acme', name: 'Acme' })
    backend.close()
    backend = undefined

    backend = new SqliteBackend(path)
    const config = new ConfigStore(backend)

    await expect(config.tenants.create({ id: 'acme', name: 'Replacement' })).rejects.toThrow()
    expect(await config.tenants.create({ id: 'other', name: 'Other' })).toEqual({ id: 'other', name: 'Other' })
  } finally {
    backend?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SqliteBackend gives separate in-memory backends independent storage', async () => {
  const first = new SqliteBackend(':memory:')
  const second = new SqliteBackend(':memory:')
  const tenant = { id: 'acme', name: 'Acme' }

  try {
    expect(await new ConfigStore(first).tenants.create(tenant)).toEqual(tenant)
    expect(await new ConfigStore(second).tenants.create(tenant)).toEqual(tenant)
  } finally {
    first.close()
    second.close()
  }
})

test('SqliteBackend rejects an unusable database path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-config-store-'))

  try {
    expect(() => new SqliteBackend(dir)).toThrow()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('SqliteBackend.close ends access for every attached config store', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new ConfigStore(backend)
  const second = new ConfigStore(backend)

  backend.close()

  await expect(first.tenants.create({ id: 'one', name: 'One' })).rejects.toThrow()
  await expect(second.tenants.create({ id: 'two', name: 'Two' })).rejects.toThrow()
})
