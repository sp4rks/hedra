import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, ConfigStore, SqliteBackend } from '#hedra.ts'

test('independent connections enforce canonical environment uniqueness and reservations survive reopening', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-reservations-'))
  const path = join(dir, 'data.sqlite')
  const firstBackend = new SqliteBackend(path)
  const secondBackend = new SqliteBackend(path)
  const first = new ConfigStore({ backend: firstBackend })
  const second = new ConfigStore({ backend: secondBackend })
  const domain = 'dev.acme.hedra.local'
  let reopened: ConfigStore | undefined

  try {
    const tenant = await first.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })
    const outcomes = await Promise.allSettled([
      first.environments.create(tenant.tenantDomain, { name: 'Dev', environmentDomain: ' DEV.ACME.HEDRA.LOCAL ' }),
      second.environments.create(tenant.tenantDomain, { name: 'Dev', environmentDomain: domain }),
    ])

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    const environment = (await first.environments.list(tenant.tenantDomain))[0]

    if (!environment) throw new Error('Environment was not created')
    await first.environments.delete(tenant.tenantDomain, environment.id)
    await first.tenants.delete(tenant.id)
    firstBackend.close()
    secondBackend.close()
    reopened = new ConfigStore({ config: new Config({ HEDRA_SQLITE_PATH: path, HEDRA_SERVER_SILENT_STARTUP: 'true' }) })
    expect(await reopened.tenants.list()).toEqual([])
    expect(await reopened.tenants.get(tenant.id)).toBeNull()
    await expect(
      reopened.tenants.create({ name: 'New party', tenantDomain: tenant.tenantDomain }),
    ).rejects.toMatchObject({ status: 409 })
    const inspect = new SqliteBackend(path)

    try {
      expect((await inspect.select('hedra_config_environments', { environmentDomain: domain }))[0]).toHaveProperty(
        'deletedAt',
      )
      await expect(
        inspect.insert('hedra_config_environments', { ...environment, id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ status: 409 })
    } finally {
      inspect.close()
    }
  } finally {
    reopened?.close()
    first.close()
    second.close()
    firstBackend.close()
    secondBackend.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
