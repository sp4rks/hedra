import { z } from 'zod'

import type { Backend } from '#datastores/backend.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import { Config } from '#config'
import { associationTable } from '#controllers/associations.ts'
import { SqliteBackend } from '#datastores/backends/sqlite/sqlite.ts'
import { ConfigStore, environmentTable, tenantTable } from '#datastores/categories/config/config.ts'
import { InputValidationError, OutputValidationError, parseInput } from '#errors'
import { Domain, isDirectDomain } from '#models/domain.ts'
import { RequestScope } from '#models/request-scope.ts'
import { Association, Resource, ResourceId, ResourceReference } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'
import { Logger } from '#server/logger.ts'

const Assignments = z.record(ResourceReference.shape.collection, z.record(ResourceId, Domain))

/** Assigns explicitly selected legacy collections while writers are stopped and a backup exists. */
export async function assignEnvironments(backend: Backend, datastore: ConfigDatastore, input: unknown): Promise<void> {
  const assignments = parseInput(Assignments, input)
  const domains = new Set(Object.values(assignments).flatMap((values) => Object.values(values)))
  const reserved = new Set(['tenants', 'environments', tenantTable, environmentTable, associationTable])

  if (Object.keys(assignments).some((name) => reserved.has(name)))
    throw new InputValidationError('Catalogue tables cannot receive application ownership')

  for (const domain of domains) {
    const parent = domain.slice(domain.indexOf('.') + 1)
    const tenants = await datastore.tenants.list({ tenantDomain: parent })

    if (tenants.length === 0 || !isDirectDomain(domain, parent))
      throw new InputValidationError('Assignment requires a provisioned tenant')
    const tenant = Tenant.safeParse(tenants[0])

    if (tenants.length !== 1 || !tenant.success || tenant.data.tenantDomain !== parent)
      throw new OutputValidationError('Invalid assignment tenant resolution')
    const environments = await datastore.environments.list(parent, { environmentDomain: domain })

    if (environments.length === 0) throw new InputValidationError('Assignment requires a provisioned environment')
    const scope = RequestScope.safeParse({ tenant: tenant.data, environment: environments[0] })

    if (environments.length !== 1 || !scope.success || scope.data.environment.environmentDomain !== domain)
      throw new OutputValidationError('Invalid assignment environment resolution')
  }

  await backend.transaction((transaction) => {
    for (const [collection, owners] of Object.entries(assignments)) {
      const records = transaction.select(collection)
      const ids = new Set(records.map((record) => record.id))

      if (Object.keys(owners).some((id) => !ids.has(id)))
        throw new InputValidationError('Assignment addresses an absent resource')

      for (const record of records) {
        const owner = owners[record.id]

        if (!owner) throw new InputValidationError('Every resource requires an explicit assignment')
        if (Object.hasOwn(record, 'environmentDomain') && record.environmentDomain !== owner)
          throw new InputValidationError('Existing ownership cannot change')
        const identity = parseInput(Resource, { ...record, environmentDomain: owner })

        transaction.update(collection, record.id, () => ({ ...record, ...identity }))
      }
    }

    for (const record of transaction.select(associationTable)) {
      const source = parseInput(ResourceReference, { collection: record.sourceCollection, id: record.sourceId })
      const target = parseInput(ResourceReference, { collection: record.targetCollection, id: record.targetId })
      const from = transaction.select(source.collection, { id: source.id })[0]
      const to = transaction.select(target.collection, { id: target.id })[0]

      if (!from || !to) throw new InputValidationError('Association endpoint is absent')
      const sourceResource = parseInput(Resource.loose(), from)
      const targetResource = parseInput(Resource.loose(), to)

      if (sourceResource.environmentDomain !== targetResource.environmentDomain)
        throw new InputValidationError('Association endpoints belong to different environments')
      const environmentDomain = sourceResource.environmentDomain

      if (Object.hasOwn(record, 'environmentDomain') && record.environmentDomain !== environmentDomain)
        throw new InputValidationError('Association ownership cannot change')
      parseInput(Association, { id: record.id, source, target, environmentDomain })
      transaction.update(associationTable, record.id, () => ({ ...record, environmentDomain }))
    }
  })
}

/** Runs the offline assignment command against the configured default SQLite stores. */
async function main(): Promise<void> {
  const config = new Config()
  const log = new Logger(config)
  let backend: SqliteBackend | undefined
  let datastore: ConfigStore | undefined

  try {
    const path = Bun.argv[2]

    if (!path || Bun.argv.length !== 3)
      throw new InputValidationError('Usage: bun scripts/assign-environments.ts ownership.json')
    const input: unknown = await Bun.file(path).json()

    backend = new SqliteBackend(config.sqlitePath)
    datastore = new ConfigStore({ config })
    await assignEnvironments(backend, datastore, input)
    log.info('Environment ownership assignment completed')
  } catch (error) {
    log.error(error instanceof InputValidationError ? error.title : 'Environment ownership assignment failed')
    process.exitCode = 1
  } finally {
    datastore?.close()
    backend?.close()
  }
}

if (import.meta.main) await main()
