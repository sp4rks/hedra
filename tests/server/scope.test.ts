import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Collection as CollectionType, ResourceInput } from '#hedra.ts'
import {
  BaseController,
  Collection,
  Config,
  EmbeddedResource,
  getAssociationScope,
  getEmbeddedScope,
  Hedra,
  Resource,
  SqliteBackend,
} from '#hedra.ts'

test('custom controllers can inspect the validated embedded route scope', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({
    config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }),
    backend,
  })
  let rootId: string | undefined
  let field: string | undefined

  class ScopedController extends BaseController {
    /** Records route scope before delegating resource creation. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      const scope = getEmbeddedScope(context)

      if (scope) {
        rootId = scope.rootId
        field = scope.steps[0]?.field.name
      }

      return super.create(context, collection, input)
    }
  }
  const Note = EmbeddedResource.extend({ text: z.string() })
  const cars = new Collection('cars', Resource.extend({ make: z.string(), notes: z.array(Note).default([]) }), {
    controller: ScopedController,
  })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(cars)
    const response = await app.request('/cars', { method: 'POST', headers, body: JSON.stringify({ make: 'Toyota' }) })
    const car = ((await response.json()) as { data: { id: string } }).data
    const created = await app.request(`/cars/${car.id}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(created.status).toBe(201)
    expect(rootId).toBe(car.id)
    expect(field).toBe('notes')
  } finally {
    app.close()
    backend.close()
  }
})

test('custom controllers can inspect association ancestors', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({
    config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }),
    backend,
  })
  let ancestors: ReturnType<typeof getAssociationScope>

  class ScopedController extends BaseController {
    /** Records validated ancestors before delegating resource lookup. */
    override async id(context: Context, collection: CollectionType, id: string) {
      ancestors = getAssociationScope(context)

      return super.id(context, collection, id)
    }
  }
  const labels = new Collection('labels', Resource.extend({ name: z.string() }), { controller: ScopedController })
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(projects)
    const parent = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'First' }) })
    const project = ((await parent.json()) as { data: { id: string } }).data
    const child = await app.request(`/projects/${project.id}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Urgent' }),
    })
    const label = ((await child.json()) as { data: { id: string } }).data

    expect((await app.request(`/projects/${project.id}/labels/${label.id}`)).status).toBe(200)
    expect(ancestors).toEqual([{ collection: 'projects', id: project.id }])
  } finally {
    app.close()
    backend.close()
  }
})
