import { expect, test } from 'bun:test'
import { Context } from 'hono'
import { z } from 'zod'

import type { Backend, BackendTransaction } from '#hedra.ts'
import { ConfigurationError, HedraError, InputValidationError, OutputValidationError, QueryError } from '#errors'
import {
  BaseController,
  Collection,
  Config,
  ConfigStore,
  getEmbeddedScope,
  Hedra,
  Logger,
  Resource,
  ResourceOperations,
  SqliteBackend,
  Tenant,
  TenantController,
} from '#hedra.ts'

test('invalid collection definitions report explicit validation issues', () => {
  let error: unknown

  try {
    new Collection('Invalid name', Resource)
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(error).toBeInstanceOf(HedraError)
  expect((error as HedraError).detail).toMatchObject([{ code: 'invalid_format' }])
})

test('transaction failures preserve thrown values while rolling back', async () => {
  const backend = new SqliteBackend(':memory:')
  const errors = [new Error('native failure'), new InputValidationError('invalid input'), 'callback failure']
  let saved: BackendTransaction | undefined

  try {
    for (const cause of errors) {
      let caught: unknown

      try {
        await backend.transaction((session) => {
          saved = session
          session.insert('items', { id: 'one' })
          throw cause
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(cause)
      expect(() => saved?.select('items')).toThrow('no longer active')
      expect(await backend.select('items')).toEqual([])
    }
    await backend.transaction((session) => session.insert('items', { id: 'success' }))
    expect(await backend.select('items')).toEqual([{ id: 'success' }])
  } finally {
    backend.close()
  }
})

test('generated routes redact unexpected model failures without storing a resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const model = Resource.extend({
    name: z.string().refine(() => {
      throw new Error('private model failure')
    }),
  })

  try {
    app.register(new Collection('items', model))
    const response = await app.request('/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(((await (await app.request('/items')).json()) as { data: unknown[] }).data).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('invalid backend input has explicit query error details', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    let caught: unknown

    try {
      await backend.insert('invalid table', { id: 'one' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(QueryError)
    expect((caught as QueryError).detail).toMatchObject([{ code: 'invalid_format' }])
    await expect(backend.select('items', { bad: [] } as never)).rejects.toBeInstanceOf(QueryError)
    await expect(backend.select('items', null as never)).rejects.toBeInstanceOf(QueryError)
    await expect(backend.insert('items', { id: 1 } as never)).rejects.toBeInstanceOf(QueryError)
  } finally {
    backend.close()
  }
})

test('JSON schema failures have explicit input and query validation categories', async () => {
  const backend = new SqliteBackend(':memory:')
  const operations = new ResourceOperations<{ value: number }>('items', backend)

  try {
    let inputError: unknown
    let queryError: unknown

    try {
      await operations.create({ value: Infinity })
    } catch (error) {
      inputError = error
    }
    try {
      await backend.insert('items', { id: 'bad', value: Infinity })
    } catch (error) {
      queryError = error
    }
    expect(inputError).toBeInstanceOf(InputValidationError)
    expect((inputError as HedraError).detail).toEqual(expect.any(Array))
    expect(queryError).toBeInstanceOf(QueryError)
    expect((queryError as HedraError).detail).toEqual(expect.any(Array))
    expect(await operations.list()).toEqual([])
  } finally {
    backend.close()
  }
})

test('controller propagates a thrown model callback unchanged', async () => {
  const backend = new SqliteBackend(':memory:')
  const cause = new Error('model callback failed')
  const model = Resource.extend({
    name: z.string().refine(() => {
      throw cause
    }),
  })
  const controller = new BaseController(backend)
  const context = new Context(new Request('http://localhost/items'))

  try {
    await expect(controller.create(context, new Collection('items', model), { name: 'Acme' })).rejects.toBe(cause)
  } finally {
    backend.close()
  }
})

test('transaction session operation failures are already Hedra errors inside the callback', async () => {
  const backend = new SqliteBackend(':memory:')
  let saved: BackendTransaction | undefined

  try {
    await backend.transaction((session) => {
      saved = session
      expect(() => session.insert('invalid table', { id: 'one' })).toThrow(HedraError)
    })
    expect(() => saved?.select('items')).toThrow(HedraError)
  } finally {
    backend.close()
  }
})

test('native SQLite failures propagate without replacing records', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('items', { id: 'one', value: 'original' })
    let error: unknown

    try {
      await backend.insert('items', { id: 'one', value: 'replacement' })
    } catch (caught) {
      error = caught
    }
    expect(error).toMatchObject({ name: 'SQLiteError', code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })
    expect(error).not.toBeInstanceOf(HedraError)
    expect(await backend.select('items')).toEqual([{ id: 'one', value: 'original' }])
  } finally {
    backend.close()
  }
})

test('programmatic resource validation throws a Hedra error', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    const resources = new ResourceOperations('items', backend)

    await expect(resources.get('invalid UUID')).rejects.toBeInstanceOf(InputValidationError)
    await expect(resources.list(null as never)).rejects.toBeInstanceOf(InputValidationError)
  } finally {
    backend.close()
  }
})

test('invalid stored resources remain internal errors', async () => {
  const backend = new SqliteBackend(':memory:')
  const id = crypto.randomUUID()

  try {
    await backend.insert('items', { id, createdAt: 'invalid', updatedAt: 'invalid' })
    const resources = new ResourceOperations('items', backend)

    await expect(resources.get(id)).rejects.toBeInstanceOf(OutputValidationError)
  } finally {
    backend.close()
  }
})

test('output validation failure is internal and prevents resource creation', async () => {
  const backend = new SqliteBackend(':memory:')
  const model = Resource.extend({ name: z.string() })
  const output = model.extend({ name: z.string().refine(() => false) })
  const collection = new Collection('items', model, { outputValidator: output })
  const controller = new BaseController(backend)
  const context = new Context(new Request('http://localhost/items'))

  try {
    await expect(controller.create(context, collection, { name: 'item' })).rejects.toBeInstanceOf(OutputValidationError)
    expect(await backend.select('items')).toEqual([])
  } finally {
    backend.close()
  }
})

test('generated routes redact output validation failures and roll back writes', async () => {
  const backend = new SqliteBackend(':memory:')
  const model = Resource.extend({ name: z.string() })
  const output = model.extend({ name: z.string().refine(() => false, 'private detail') })
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })

  try {
    app.register(new Collection('items', model, { outputValidator: output }))
    const response = await app.request('/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'item' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(await backend.select('items')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('configuration and logger input validation throw Hedra errors', () => {
  expect(() => new Config({ invalid: 2 } as never)).toThrow(ConfigurationError)
  expect(() => new ConfigStore(null as never)).toThrow(HedraError)
  const logger = new Logger(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }))

  expect(() => logger.info('test', null as never)).toThrow(HedraError)
})

test('direct controller and scope input failures throw Hedra errors', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const context = new Context(new Request('http://localhost/items'))

  try {
    await expect(controller.id(context, new Collection('items', Resource), 'invalid')).rejects.toBeInstanceOf(
      HedraError,
    )
    context.set('hedraScope' as never, { rootId: 'invalid' } as never)
    expect(() => getEmbeddedScope(context)).toThrow(HedraError)
  } finally {
    backend.close()
  }
})

test('registration propagates controller constructor failures and leaves the collection unattached', () => {
  const cause = new Error('controller failed')

  class BrokenController extends BaseController {
    constructor(backend: Backend) {
      super(backend)
      throw cause
    }
  }
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }) })
  const collection = new Collection('items', Resource, { controller: BrokenController })
  let caught: unknown

  try {
    try {
      app.register(collection)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(cause)
    expect(() => collection.controller).toThrow(HedraError)
  } finally {
    app.close()
  }
})

test('a guarded borrowed backend propagates failures to custom controllers', async () => {
  const cause = new Error('backend failed')
  const backend: Backend = {
    insert: async () => {
      throw cause
    },
    select: async () => [],
    update: async () => null,
    delete: async () => false,
    transaction: async (work) =>
      work({
        insert: () => {
          throw cause
        },
        select: () => {
          throw cause
        },
        update: () => {
          throw cause
        },
        delete: () => {
          throw cause
        },
      }),
  }

  class CustomController extends BaseController {
    async insert(): Promise<void> {
      await this.backend.insert('items', { id: 'one' })
    }

    async transaction(): Promise<void> {
      await this.backend.transaction((session) => {
        expect(() => session.select('items')).toThrow('backend failed')
      })
    }
  }

  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const collection = new Collection('items', Resource, { controller: CustomController })

  try {
    app.register(collection)
    let caught: unknown

    try {
      await collection.controller.insert()
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(cause)
    await collection.controller.transaction()
  } finally {
    app.close()
  }
})

test('tenant controller operations propagate injected datastore failures by identity', async () => {
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const context = new Context(
    new Request('http://deployment.hedra.local/tenants', {
      headers: { host: 'deployment.hedra.local' },
    }),
  )
  const collection = new Collection('tenants', Tenant)
  const id = crypto.randomUUID()
  const fields = { name: 'Acme', tenantDomain: 'acme.hedra.local' }

  for (const cause of [new Error('datastore unavailable'), new QueryError('existing error')]) {
    const fail = async () => {
      throw cause
    }
    const controller = new TenantController(config, () => ({
      tenants: { create: fail, get: fail, list: fail, update: fail, replace: fail, delete: fail },
    }))
    const calls = [
      () => controller.create(context, collection, fields),
      () => controller.id(context, collection, id),
      () => controller.list(context, collection, context.req.url),
      () => controller.update(context, collection, { name: 'Changed' }, id),
      () => controller.delete(context, collection, id),
    ]

    for (const call of calls) {
      let caught: unknown

      try {
        await call()
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(cause)
    }
  }
})

test('tenant datastore reads and writes propagate backend failures by identity', async () => {
  const id = crypto.randomUUID()
  const fields = { name: 'Acme', tenantDomain: 'acme.hedra.local' }

  for (const cause of [new Error('backend unavailable'), new QueryError('existing error')]) {
    const fail = async () => {
      throw cause
    }
    const backend: Backend = {
      insert: fail,
      select: fail,
      update: fail,
      delete: fail,
      transaction: fail,
    }
    const store = new ConfigStore({ backend })
    const calls = [
      () => store.tenants.create(fields),
      () => store.tenants.get(id),
      () => store.tenants.list(),
      () => store.tenants.update(id, { name: 'Changed' }),
      () => store.tenants.replace(id, fields),
    ]

    for (const call of calls) {
      let caught: unknown

      try {
        await call()
      } catch (error) {
        caught = error
      }
      expect(caught).toBe(cause)
    }
    store.close()
  }
})

test('tenant controller classifies invalid list response URLs', async () => {
  const backend = new SqliteBackend(':memory:')
  const store = new ConfigStore({ backend })
  const controller = new TenantController(new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), () => store)
  const context = new Context(
    new Request('http://deployment.hedra.local/tenants', {
      headers: { host: 'deployment.hedra.local' },
    }),
  )

  try {
    let caught: unknown

    try {
      await controller.list(context, new Collection('tenants', Tenant), 'not a URL')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(OutputValidationError)
    expect((caught as HedraError).detail).toMatchObject([{ code: 'invalid_format' }])
    await expect(
      controller.list(context, new Collection('tenants', Tenant), context.req.url, null as never),
    ).rejects.toBeInstanceOf(InputValidationError)
  } finally {
    store.close()
    backend.close()
  }
})
