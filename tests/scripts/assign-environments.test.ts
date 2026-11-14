import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Backend, Environment, Tenant } from '#hedra.ts'
import { ConfigStore, SqliteBackend } from '#hedra.ts'
import { assignEnvironments } from '../../scripts/assign-environments.ts'

test('offline assignment preserves resources and rolls back incomplete ownership mappings', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-assignment-'))
  const database = join(dir, 'data.sqlite')
  const manifest = join(dir, 'ownership.json')
  const backend = new SqliteBackend(database)
  const store = new ConfigStore({ backend })
  const id = crypto.randomUUID()
  const otherId = crypto.randomUUID()
  const timestamp = '2026-01-01T00:00:00.000Z'
  const domain = 'dev.acme.hedra.local'
  const run = async (assignments: unknown) => {
    await Bun.write(manifest, JSON.stringify(assignments))
    const process = Bun.spawn([Bun.which('bun') ?? 'bun', 'scripts/assign-environments.ts', manifest], {
      cwd: join(import.meta.dir, '../..'),
      env: {
        ...Bun.env,
        HEDRA_SQLITE_PATH: database,
        HEDRA_SERVER_SILENT_STARTUP: 'true',
        HEDRA_SERVER_LOG_LEVEL: 'silent',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    return await process.exited
  }

  try {
    await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    await store.environments.create('acme.hedra.local', { name: 'Dev', environmentDomain: domain })
    const first = { id, name: 'One', createdAt: timestamp, updatedAt: timestamp }
    const second = { id: otherId, name: 'Two', createdAt: timestamp, updatedAt: timestamp }

    await backend.insert('widgets', first)
    await backend.insert('widgets', second)
    expect(await run({ widgets: { [id]: domain } })).toBe(1)
    expect(await backend.select('widgets')).toEqual([first, second])
    const complete = { widgets: { [id]: domain, [otherId]: domain } }

    expect(await run(complete)).toBe(0)
    expect(await backend.select('widgets')).toEqual([
      { ...first, environmentDomain: domain },
      { ...second, environmentDomain: domain },
    ])
    expect(await run(complete)).toBe(0)
    expect(await run({ widgets: { [id]: 'missing.acme.hedra.local', [otherId]: domain } })).toBe(1)

    for (const table of [
      'tenants',
      'environments',
      'hedra_config_tenants',
      'hedra_config_environments',
      'hedra_associations',
    ]) {
      expect(await run({ [table]: { [id]: domain } })).toBe(1)
    }
    await store.environments.create('acme.hedra.local', {
      name: 'Production',
      environmentDomain: 'prod.acme.hedra.local',
    })
    const foreignId = crypto.randomUUID()
    const foreign = { id: foreignId, name: 'Foreign', createdAt: timestamp, updatedAt: timestamp }

    await backend.insert('other_widgets', foreign)
    await backend.insert('hedra_associations', {
      id: crypto.randomUUID(),
      sourceCollection: 'widgets',
      sourceId: id,
      targetCollection: 'other_widgets',
      targetId: foreignId,
    })
    expect(await run({ other_widgets: { [foreignId]: 'prod.acme.hedra.local' } })).toBe(1)
    expect(await backend.select('other_widgets')).toEqual([foreign])
  } finally {
    store.close()
    backend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('assignment validates complete injected scope outputs and exact requested domains before writing', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-01T00:00:00.000Z'
  const row = { id, name: 'Legacy', createdAt: timestamp, updatedAt: timestamp }
  let transactions = 0
  const target: Backend = {
    ensureIndexes: backend.ensureIndexes.bind(backend),
    insert: backend.insert.bind(backend),
    select: backend.select.bind(backend),
    update: backend.update.bind(backend),
    delete: backend.delete.bind(backend),
    transaction: (work) => {
      transactions++

      return backend.transaction(work)
    },
  }

  try {
    const tenant = await store.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const production = await store.environments.create(tenant.tenantDomain, {
      name: 'Prod',
      environmentDomain: 'prod.acme.hedra.local',
    })

    await backend.insert('widgets', row)
    const cases = [
      [tenant, production],
      [tenant, { ...production, name: undefined, environmentDomain: 'dev.acme.hedra.local' }],
      [
        { ...tenant, tenantDomain: 'other.hedra.local' },
        { ...production, environmentDomain: 'dev.acme.hedra.local' },
      ],
      [
        { ...tenant, name: undefined },
        { ...production, environmentDomain: 'dev.acme.hedra.local' },
      ],
    ]

    for (const [tenantValue, environmentValue] of cases) {
      const tenants = new Proxy(store.tenants, {
        get(owner, property) {
          if (property === 'list') return async () => [tenantValue] as Tenant[]
          const value = Reflect.get(owner, property)

          return typeof value === 'function' ? value.bind(owner) : value
        },
      })
      const environments = new Proxy(store.environments, {
        get(owner, property) {
          if (property === 'list') return async () => [environmentValue] as Environment[]
          const value = Reflect.get(owner, property)

          return typeof value === 'function' ? value.bind(owner) : value
        },
      })

      await expect(
        assignEnvironments(target, { tenants, environments }, { widgets: { [id]: 'dev.acme.hedra.local' } }),
      ).rejects.toMatchObject({ status: 500 })
      expect(await backend.select('widgets')).toEqual([row])
    }
    expect(transactions).toBe(0)
  } finally {
    store.close()
    backend.close()
  }
})
