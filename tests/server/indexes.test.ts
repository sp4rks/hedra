import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Backend, DatabaseIndex } from '#hedra.ts'
import { ConfigurationError } from '#errors'
import { BaseController, Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'
import { provision, request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('a later registered collection enforces environment compound uniqueness and returns safe HTTP conflicts', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const items = Resource.extend({ sku: z.string() }).meta({
    name: 'items',
    compoundUnique: [{ fields: ['environmentDomain', 'sku'] }],
  })

  try {
    const earlier = Resource.meta({ name: 'earlier' })
    const controller = app.register(earlier)
    const context = await scopedContext()

    await controller.list(context, earlier, context.req.url)
    app.register(items)
    const domain = await provision(app)
    const tenantDomain = domain.slice(domain.indexOf('.') + 1)
    const prod = await app.configDatastore.environments.create(tenantDomain, {
      name: 'Production',
      environmentDomain: `prod.${tenantDomain}`,
    })
    const create = (host: string, sku: string) =>
      request(app, '/items', {
        method: 'POST',
        headers: { host, 'content-type': 'application/json' },
        body: JSON.stringify({ sku }),
      })
    const original = await create(domain, 'private-sku')
    const other = await create(domain, 'other')
    const otherData = JsonApiResponse.parse(await other.json())

    expect(original.status).toBe(201)
    expect(other.status).toBe(201)
    expect((await create(prod.environmentDomain, 'private-sku')).status).toBe(201)
    const duplicate = await create(domain, 'private-sku')

    expect(duplicate.status).toBe(409)
    expect(await duplicate.json()).toEqual({ errors: [{ status: 409, title: 'uniqueness violation' }] })
    const update = await request(app, `/items/${otherData.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sku: 'private-sku' }),
    })

    expect(update.status).toBe(409)
    expect(JsonApiResponse.parse(await (await request(app, `/items/${otherData.data.id}`)).json()).data.sku).toBe(
      'other',
    )
    expect(JsonApiListResponse.parse(await (await request(app, '/items')).json()).data).toHaveLength(2)
  } finally {
    app.close()
  }
})

test.each([
  z.string().meta({ unique: true }).optional(),
  z.string().meta({ unique: true }).nullable(),
  z.string().meta({ unique: true }).default('fallback'),
  z.string().optional().meta({ unique: true }),
  z.string().nullable().meta({ unique: true }),
  z.string().default('fallback').meta({ unique: true }),
])('registration enforces unique metadata on a wrapped field %#', async (field) => {
  const app = new Hedra({ config: new Config(quiet) })
  const items = Resource.extend({ sku: field }).meta({ name: 'items' })
  const context = await scopedContext()

  try {
    const controller = app.register(items)

    await controller.create(context, items, { sku: 'same' })
    await expect(controller.create(context, items, { sku: 'same' })).rejects.toMatchObject({ status: 409 })
  } finally {
    app.close()
  }
})

test('registration combines wrapped index flags with outer explicit values taking precedence', async () => {
  class ObservedBackend extends SqliteBackend {
    readonly definitions: DatabaseIndex[] = []

    /** Records the public backend preparation contract before installing the real indexes. */
    override async ensureIndexes(table: string, indexes: readonly DatabaseIndex[]): Promise<void> {
      this.definitions.push(...indexes)
      await super.ensureIndexes(table, indexes)
    }
  }
  const backend = new ObservedBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const items = Resource.extend({
    enabled: z.string().meta({ unique: false }).optional().meta({ unique: true }),
    disabled: z.string().meta({ unique: true, indexed: true }).nullable().meta({ unique: false }),
    indexed: z.string().meta({ indexed: true }).default('fallback').optional(),
    ignored: z.string().meta({ indexed: true }).optional().meta({ indexed: false }),
    mixed: z.string().meta({ unique: true }).nullable().meta({ indexed: false }),
  }).meta({ name: 'items', description: 'Unrelated metadata remains valid' })
  const context = await scopedContext()

  try {
    const controller = app.register(items)

    await controller.list(context, items, context.req.url)
    expect(backend.definitions).toEqual([
      { field: 'environmentDomain', unique: false },
      { field: 'enabled', unique: true },
      { field: 'disabled', unique: false },
      { field: 'indexed', unique: false },
      { field: 'mixed', unique: true },
    ])
  } finally {
    app.close()
    backend.close()
  }
})

test.each([
  null,
  {},
  [{ fields: [] }],
  [{ fields: ['sku'] }],
  [{ fields: ['sku', 'sku'] }],
  [{ fields: ['sku', 'missing'] }],
  [{ fields: ['sku', 'toString'] }],
  [{ fields: ['sku', 'environmentDomain'], unsupported: true }],
  [{ fields: ['sku', 42] }],
  [{ fields: ['sku', 'environmentDomain; DROP TABLE items'] }],
])('registration rejects malformed compound metadata before constructing a controller %#', (compoundUnique) => {
  const app = new Hedra({ config: new Config(quiet) })
  let constructed = false

  class Observed extends BaseController {
    /** Detects whether invalid metadata reached controller construction. */
    constructor(backend: Backend) {
      super(backend)
      constructed = true
    }
  }
  const items = Resource.extend({ sku: z.string() }).meta({ name: 'items', compoundUnique })

  try {
    expect(() => app.register(items, { controller: Observed })).toThrow(ConfigurationError)
    expect(constructed).toBe(false)
    expect(app.register(Resource.meta({ name: 'items' }))).toBeInstanceOf(BaseController)
  } finally {
    app.close()
  }
})

test.each(['unique', 'indexed'])(
  'registration validates inner %s flags even when outer metadata overrides them',
  (flag) => {
    const app = new Hedra({ config: new Config(quiet) })
    const field = z
      .string()
      .meta({ [flag]: 'true' })
      .optional()
      .meta({ [flag]: false })
    const items = Resource.extend({ sku: field }).meta({ name: 'items' })

    try {
      expect(() => app.register(items)).toThrow(ConfigurationError)
    } finally {
      app.close()
    }
  },
)
