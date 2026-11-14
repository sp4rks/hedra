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
