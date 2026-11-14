import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ConfigStore, SqliteBackend } from '#hedra.ts'

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
