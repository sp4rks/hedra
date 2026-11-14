import { expect, test } from 'bun:test'
import { Context } from 'hono'
import { z } from 'zod'

import type { Backend } from '#hedra.ts'
import { ConnectionError, OutputValidationError, PreconditionFailedError } from '#errors'
import {
  BaseController,
  Collection,
  Config,
  ConfigStore,
  getRequestScope,
  Hedra,
  Resource,
  SqliteBackend,
} from '#hedra.ts'
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
  const widgets = new Collection('widgets', Resource.extend({ name: z.string() }))
  const context = await scopedContext('http://localhost/widgets')

  try {
    app.register(widgets)
    await expect(store.tenants.list()).rejects.toBe(cause)
    await expect(store.environments.list('fixture.hedra.local')).rejects.toBe(cause)
    await expect(widgets.controller.list(context, widgets, context.req.url)).rejects.toBe(cause)
    await expect(widgets.controller.list(context, widgets, context.req.url)).rejects.toBe(cause)
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
  const widgets = new Collection('widgets', Resource.extend({ name: z.string() }))
  const context = await scopedContext('http://localhost/widgets')

  try {
    app.register(widgets)
    const operation = widgets.controller.create(context, widgets, { name: 'Blocked' })

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
  const widgets = new Collection('widgets', Resource.extend({ name: z.string() }))
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
  const widgets = new Collection('widgets', Resource.extend({ name: z.string() }))
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
  const widgets = new Collection('widgets', Resource, { controller: ConstructorWriter })

  try {
    app.register(widgets)
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['index-start'])
    release?.()
    await widgets.controller.write
    expect(events).toEqual(['index-start', 'index-ready', 'insert'])
  } finally {
    release?.()
    await widgets.controller.write.catch(() => {})
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
  const existing = new Collection('existing', Resource)
  const widgets = new Collection('widgets', Resource, { controller: ConstructorWriter })
  const context = await scopedContext('http://localhost/widgets')

  try {
    app.register(existing)
    expect(() => app.register(widgets)).toThrow(cause)
    expect(await Promise.allSettled(attempts)).toMatchObject([{ status: 'rejected', reason: cause }])
    expect(await backend.select('widgets')).toEqual([])
    expect((await existing.controller.list(context, existing, context.req.url)).data).toEqual([])
    failing = false
    app.register(widgets)
    await widgets.controller.write
    expect(await backend.select('widgets')).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})

test('abandoned graph controllers do not leave unhandled constructor-write rejections', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const cause = new Error('later graph constructor failed')

  class Writer extends BaseController {
    readonly write: Promise<void>

    /** Stores a promise that becomes unreachable if a later graph constructor fails. */
    constructor(selected: Backend) {
      super(selected)
      this.write = selected.insert('widgets', { id: crypto.randomUUID(), environmentDomain: 'dev.fixture.hedra.local' })
    }
  }
  class Fails extends BaseController {
    /** Rejects the graph after its target controller has been constructed. */
    constructor(selected: Backend) {
      super(selected)
      throw cause
    }
  }
  const widgets = new Collection('widgets', Resource, { controller: Writer })
  const broken = new Collection('broken', Resource, { controller: Fails, associations: [widgets] })

  try {
    expect(() => app.register(broken)).toThrow(cause)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(await backend.select('widgets')).toEqual([])
    expect(() => widgets.controller).toThrow('registered')
  } finally {
    app.close()
    backend.close()
  }
})
