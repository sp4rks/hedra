import { expect, test } from 'bun:test'
import { Context } from 'hono'
import { z } from 'zod'

import type { Backend } from '#hedra.ts'
import { ConfigurationError, ConnectionError, OutputValidationError, PreconditionFailedError } from '#errors'
import { BaseController, Config, ConfigStore, getRequestScope, Hedra, Resource, SqliteBackend } from '#hedra.ts'
import { scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

/** Forwards data operations while a test supplies the backend readiness behavior. */
function indexedBackend(backend: SqliteBackend, ensureIndexes: Backend['ensureIndexes']): Backend {
  return {
    ensureIndexes,
    insert: backend.insert.bind(backend),
    select: backend.select.bind(backend),
    update: backend.update.bind(backend),
    delete: backend.delete.bind(backend),
    transaction: backend.transaction.bind(backend),
  }
}

test('failed index readiness remains observable on configuration and collection operations', async () => {
  const backend = new SqliteBackend(':memory:')
  const cause = new Error('index preparation failed')
  const injected = indexedBackend(backend, async () => {
    throw cause
  })
  const store = new ConfigStore({ backend: injected })
  const app = new Hedra({ config: new Config(quiet), backend: injected })
  const widgets = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })
  const context = await scopedContext('http://localhost/widgets')

  try {
    const widgetsController = app.register(widgets)

    await expect(store.tenants.list()).rejects.toBe(cause)
    await expect(store.environments.list('fixture.hedra.local')).rejects.toBe(cause)
    await expect(widgetsController.list(context, widgets, context.req.url)).rejects.toBe(cause)
    await expect(widgetsController.list(context, widgets, context.req.url)).rejects.toBe(cause)
    expect(await backend.select('widgets')).toEqual([])
  } finally {
    app.close()
    store.close()
    backend.close()
  }
})

test('closing during pending index preparation prevents a saved controller from writing', async () => {
  const backend = new SqliteBackend(':memory:')
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const app = new Hedra({ config: new Config(quiet), backend: indexedBackend(backend, async () => pending) })
  const widgets = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })
  const context = await scopedContext('http://localhost/widgets')

  try {
    const widgetsController = app.register(widgets)
    const operation = widgetsController.create(context, widgets, { name: 'Blocked' })

    await Promise.resolve()
    app.close()
    release?.()
    await expect(operation).rejects.toBeInstanceOf(ConnectionError)
    expect(await backend.select('widgets')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('direct application controllers require a validated request scope', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const widgets = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })
  const context = new Context(new Request('http://localhost/widgets'))

  try {
    expect(getRequestScope(context)).toBeUndefined()
    await expect(controller.create(context, widgets, { name: 'Unscoped' })).rejects.toBeInstanceOf(
      PreconditionFailedError,
    )
    context.set('hedraRequestScope' as never, {} as never)
    expect(() => getRequestScope(context)).toThrow(OutputValidationError)
    expect(await backend.select('widgets')).toEqual([])
  } finally {
    backend.close()
  }
})

test('direct updates reject ownership hidden by a getter that removes its raw key', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const widgets = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })
  const context = await scopedContext('http://localhost/widgets')

  try {
    const original = await controller.create(context, widgets, { name: 'Original' })
    const id = z.uuid().parse(original.data.id)
    const changes: Record<string, string> = { name: 'Moved' }

    Object.defineProperty(changes, 'environmentDomain', {
      enumerable: true,
      configurable: true,
      get() {
        delete changes.environmentDomain

        return 'prod.fixture.hedra.local'
      },
    })
    await expect(controller.update(context, widgets, changes, id)).rejects.toMatchObject({ status: 422 })
    expect((await controller.id(context, widgets, id)).data).toEqual(original.data)
  } finally {
    backend.close()
  }
})

test('constructor-triggered writes wait for the registration indexes to finish', async () => {
  const backend = new SqliteBackend(':memory:')
  const events: string[] = []
  let release: (() => void) | undefined
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const injected = indexedBackend(backend, async (...args) => {
    events.push('index-start')
    await pending
    await backend.ensureIndexes(...args)
    events.push('index-ready')
  })

  injected.insert = async (...args) => {
    events.push('insert')
    await backend.insert(...args)
  }
  class ConstructorWriter extends BaseController {
    readonly write: Promise<void>

    /** Starts work that must remain behind this registration's index preparation. */
    constructor(selected: Backend) {
      super(selected)
      this.write = selected.insert('widgets', { id: crypto.randomUUID(), environmentDomain: 'dev.fixture.hedra.local' })
    }
  }
  const app = new Hedra({ config: new Config(quiet), backend: injected })
  const widgets = Resource.meta({ name: 'widgets' })
  const widgetsController = app.register(widgets, { controller: ConstructorWriter })

  try {
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['index-start'])
    release?.()
    await widgetsController.write
    expect(events).toEqual(['index-start', 'index-ready', 'insert'])
  } finally {
    release?.()
    await widgetsController.write.catch(() => {})
    app.close()
    backend.close()
  }
})

test('failed constructors cancel their writes without poisoning earlier or retried registrations', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const attempts: Promise<void>[] = []
  const cause = new Error('constructor failed')
  let failing = true

  class ConstructorWriter extends BaseController {
    readonly write: Promise<void>

    /** Records pending work so construction failure can be checked through its returned promise. */
    constructor(selected: Backend) {
      super(selected)
      this.write = selected.insert('widgets', { id: crypto.randomUUID(), environmentDomain: 'dev.fixture.hedra.local' })
      attempts.push(this.write)
      void this.write.catch(() => {})
      if (failing) throw cause
    }
  }
  const existing = Resource.meta({ name: 'existing' })
  const widgets = Resource.meta({ name: 'widgets' })
  const context = await scopedContext('http://localhost/widgets')

  try {
    const existingController = app.register(existing)

    expect(() => app.register(widgets, { controller: ConstructorWriter })).toThrow(cause)
    expect(await Promise.allSettled(attempts)).toMatchObject([{ status: 'rejected', reason: cause }])
    expect(await backend.select('widgets')).toEqual([])
    expect((await existingController.list(context, existing, context.req.url)).data).toEqual([])
    failing = false
    const widgetsController = app.register(widgets, { controller: ConstructorWriter })

    await widgetsController.write
    expect(await backend.select('widgets')).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})

test('abandoned constructor writes are cancelled without unhandled rejections', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const cause = new Error('constructor failed')

  class Fails extends BaseController {
    /** Abandons pending work when construction fails. */
    constructor(selected: Backend) {
      super(selected)
      void selected.insert('widgets', { id: crypto.randomUUID(), environmentDomain: 'dev.fixture.hedra.local' })
      throw cause
    }
  }

  try {
    expect(() => app.register(Resource.meta({ name: 'widgets' }), { controller: Fails })).toThrow(cause)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await backend.select('widgets')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('earlier controllers wait for a later addressed collection and its unique indexes', async () => {
  const backend = new SqliteBackend(':memory:')
  const release = Promise.withResolvers<void>()
  const started = Promise.withResolvers<void>()
  const injected = indexedBackend(backend, async (table, indexes) => {
    if (table === 'later') {
      started.resolve()
      await release.promise
    }
    await backend.ensureIndexes(table, indexes)
  })
  const app = new Hedra({ config: new Config(quiet), backend: injected })
  const earlier = Resource.meta({ name: 'earlier' })
  const later = Resource.extend({
    name: z.string().meta({ unique: true, indexed: false, description: 'A unique display name' }),
  }).meta({ name: 'later' })
  const context = await scopedContext('http://localhost/later')
  let writes: Promise<PromiseSettledResult<unknown>[]> | undefined

  try {
    const earlierController = app.register(earlier)

    await earlierController.list(context, earlier, context.req.url)
    app.register(later)
    writes = Promise.allSettled([
      earlierController.create(context, later, { name: 'Same name' }),
      earlierController.create(context, later, { name: 'Same name' }),
    ])
    await started.promise
    expect(await backend.select('later')).toEqual([])
    release.resolve()
    const outcomes = await writes

    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
    expect(await backend.select('later')).toHaveLength(1)
  } finally {
    release.resolve()
    await writes
    app.close()
    backend.close()
  }
})

test.each(['indexed', 'unique'])('registration rejects a malformed %s metadata flag', (flag) => {
  const app = new Hedra({ config: new Config(quiet) })
  const widgets = Resource.extend({ name: z.string().meta({ [flag]: 'true' }) }).meta({ name: 'widgets' })

  try {
    expect(() => app.register(widgets)).toThrow(ConfigurationError)
  } finally {
    app.close()
  }
})

test('registration accepts unrelated field metadata and false index flags without enforcing uniqueness', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  const widgets = Resource.extend({
    name: z
      .string()
      .meta({ unique: false, indexed: false, description: 'A reusable display name', examples: ['Same'] }),
  }).meta({ name: 'widgets' })
  const context = await scopedContext('http://localhost/widgets')

  try {
    const widgetsController = app.register(widgets)

    await widgetsController.create(context, widgets, { name: 'Same' })
    await widgetsController.create(context, widgets, { name: 'Same' })
    expect((await widgetsController.list(context, widgets, context.req.url)).data).toHaveLength(2)
  } finally {
    app.close()
  }
})
