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
} from '#hedra.ts'

test('invalid collection definitions throw Hedra errors with their validation cause', () => {
  let error: unknown

  try {
    new Collection('Invalid name', Resource)
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(error).toBeInstanceOf(HedraError)
  expect((error as HedraError).cause).toBeInstanceOf(Error)
  expect(Object.keys(error as object)).not.toContain('cause')
})

test('transaction failures preserve Hedra errors and wrap thrown values while rolling back', async () => {
  const backend = new SqliteBackend(':memory:')
  const original = new InputValidationError('invalid input')

  try {
    await expect(
      backend.transaction(() => {
        throw original
      }),
    ).rejects.toBe(original)
    let caught: unknown

    try {
      await backend.transaction((session) => {
        session.insert('items', { id: 'one' })
        throw 'callback failure'
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(HedraError)
    expect((caught as HedraError).cause).toBe('callback failure')
    expect(await backend.select('items')).toEqual([])
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

test('SQLite operation failures retain their cause and do not replace records', async () => {
  const backend = new SqliteBackend(':memory:')

  try {
    await backend.insert('items', { id: 'one', value: 'original' })
    let error: unknown

    try {
      await backend.insert('items', { id: 'one', value: 'replacement' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(QueryError)
    expect((error as HedraError).cause).toBeInstanceOf(Error)
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

test('registration wraps custom controller constructor failures and leaves the collection unattached', () => {
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
    expect(caught).toBeInstanceOf(HedraError)
    expect((caught as HedraError).cause).toBe(cause)
    expect(() => collection.controller).toThrow(HedraError)
  } finally {
    app.close()
  }
})

test('a guarded borrowed backend normalizes failures for custom controllers', async () => {
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
        expect(() => session.select('items')).toThrow(HedraError)
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
    expect(caught).toBeInstanceOf(HedraError)
    expect((caught as HedraError).cause).toBe(cause)
    await collection.controller.transaction()
  } finally {
    app.close()
  }
})
