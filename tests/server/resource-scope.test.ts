import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Collection as CollectionType, QueryParams, ResourceInput, ResourceScope } from '#hedra.ts'
import {
  BaseController,
  Collection,
  Config,
  EmbeddedResource,
  getAssociationScope,
  getEmbeddedScope,
  getResourceScope,
  Hedra,
  Resource,
  SqliteBackend,
} from '#hedra.ts'

const headers = { 'content-type': 'application/json' }

test('root REST requests describe collection and UUID targets', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const seen: Array<ResourceScope | undefined> = []

  class ScopedController extends BaseController {
    /** Records the request scope before delegating resource creation. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      seen.push(getResourceScope(context))

      return super.create(context, collection, input)
    }
    /** Records the request scope before delegating resource lookup. */
    override async id(context: Context, collection: CollectionType, id: string) {
      seen.push(getResourceScope(context))

      return super.id(context, collection, id)
    }
    /** Records the request scope before delegating resource listing. */
    override async list(context: Context, collection: CollectionType, baseUrl: string, params?: QueryParams) {
      seen.push(getResourceScope(context))

      return super.list(context, collection, baseUrl, params)
    }
    /** Records the request scope before delegating resource update. */
    override async update(context: Context, collection: CollectionType, input: ResourceInput, id: string) {
      seen.push(getResourceScope(context))

      return super.update(context, collection, input, id)
    }
    /** Records the request scope before delegating resource deletion. */
    override async delete(context: Context, collection: CollectionType, id: string) {
      seen.push(getResourceScope(context))

      return super.delete(context, collection, id)
    }
  }
  app.register(new Collection('cars', Resource.extend({ make: z.string() }), { controller: ScopedController }))

  try {
    expect((await app.request('/cars')).status).toBe(200)
    const created = await app.request('/cars', { method: 'POST', headers, body: JSON.stringify({ make: 'Toyota' }) })
    const body = (await created.json()) as { data: { id: string }; links: { self: string } }
    const id = body.data.id

    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toBe(body.links.self)
    expect((await app.request(`/cars/${id}`)).status).toBe(200)
    expect(
      (await app.request(`/cars/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ make: 'Mazda' }) })).status,
    ).toBe(200)
    expect((await app.request(`/cars/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(seen).toEqual([
      { collection: 'cars', target: { kind: 'collection' as const }, associations: [] },
      { collection: 'cars', target: { kind: 'collection' as const }, associations: [] },
      { collection: 'cars', target: { kind: 'resource' as const, id }, associations: [] },
      { collection: 'cars', target: { kind: 'resource' as const, id }, associations: [] },
      { collection: 'cars', target: { kind: 'resource' as const, id }, associations: [] },
    ])
  } finally {
    app.close()
    backend.close()
  }
})

test('embedded array requests distinguish containers from UUID selectors', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const seen: Array<{ scope: ResourceScope | undefined; embedded: ReturnType<typeof getEmbeddedScope> }> = []
  /** Records the public resource and embedded scopes. */
  const record = (context: Context) =>
    seen.push({ scope: getResourceScope(context), embedded: getEmbeddedScope(context) })

  class ScopedController extends BaseController {
    /** Records the request scope before delegating resource creation. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      record(context)

      return super.create(context, collection, input)
    }
    /** Records the request scope before delegating resource lookup. */
    override async id(context: Context, collection: CollectionType, id: string) {
      record(context)

      return super.id(context, collection, id)
    }
    /** Records the request scope before delegating resource listing. */
    override async list(context: Context, collection: CollectionType, baseUrl: string, params?: QueryParams) {
      record(context)

      return super.list(context, collection, baseUrl, params)
    }
    /** Records the request scope before delegating resource update. */
    override async update(context: Context, collection: CollectionType, input: ResourceInput, id: string) {
      record(context)

      return super.update(context, collection, input, id)
    }
    /** Records the request scope before delegating resource deletion. */
    override async delete(context: Context, collection: CollectionType, id: string) {
      record(context)

      return super.delete(context, collection, id)
    }
  }
  const Note = EmbeddedResource.extend({ text: z.string() })

  app.register(
    new Collection('cars', Resource.extend({ notes: z.array(Note).default([]) }), { controller: ScopedController }),
  )
  try {
    const rootResponse = await app.request('/cars', { method: 'POST', headers, body: '{}' })
    const rootId = ((await rootResponse.json()) as { data: { id: string } }).data.id
    const path = `/cars/${rootId}/notes`

    seen.length = 0
    expect((await app.request(path)).status).toBe(200)
    const created = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) })
    const id = ((await created.json()) as { data: { id: string } }).data.id

    expect(created.status).toBe(201)
    expect((await app.request(`${path}/${id}`)).status).toBe(200)
    expect(
      (await app.request(`${path}/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ text: 'changed' }) }))
        .status,
    ).toBe(200)
    expect((await app.request(`${path}/${id}`, { method: 'DELETE' })).status).toBe(204)
    const collectionStep = { field: 'notes', kind: 'array' as const }
    const itemStep = { field: 'notes', kind: 'array' as const, id }

    expect(seen).toEqual(
      [collectionStep, collectionStep, itemStep, itemStep, itemStep].map((step) => ({
        scope: { collection: 'cars', target: { kind: 'embedded' as const, rootId, steps: [step] }, associations: [] },
        embedded: { rootId, steps: [step] },
      })),
    )
  } finally {
    app.close()
    backend.close()
  }
})

test('association chains describe every ancestor and the addressed target', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const seen: Array<ResourceScope | undefined> = []
  const seenAssociations: Array<ReturnType<typeof getAssociationScope>> = []

  class ScopedController extends BaseController {
    /** Records the request scope before delegating resource creation. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      seen.push(getResourceScope(context))

      return super.create(context, collection, input)
    }
    /** Records the request scope before delegating resource lookup. */
    override async id(context: Context, collection: CollectionType, id: string) {
      seen.push(getResourceScope(context))
      seenAssociations.push(getAssociationScope(context))

      return super.id(context, collection, id)
    }
    /** Records the request scope before delegating resource listing. */
    override async list(context: Context, collection: CollectionType, baseUrl: string, params?: QueryParams) {
      seen.push(getResourceScope(context))

      return super.list(context, collection, baseUrl, params)
    }
    /** Records the request scope before delegating resource update. */
    override async update(context: Context, collection: CollectionType, input: ResourceInput, id: string) {
      seen.push(getResourceScope(context))

      return super.update(context, collection, input, id)
    }
    /** Records the request scope before delegating resource deletion. */
    override async delete(context: Context, collection: CollectionType, id: string) {
      seen.push(getResourceScope(context))

      return super.delete(context, collection, id)
    }
  }
  const tags = new Collection('tags', Resource.extend({ name: z.string() }), { controller: ScopedController })
  const labels = new Collection('labels', Resource.extend({ name: z.string() }), { associations: [tags] })
  const projects = new Collection('projects', Resource.extend({ name: z.string() }), { associations: [labels] })
  /** Creates a named resource through its generated route and returns its ID. */
  const create = async (path: string, name: string) => {
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ name }) })

    expect(response.status).toBe(201)

    return ((await response.json()) as { data: { id: string } }).data.id
  }

  try {
    app.register(projects)
    const project = await create('/projects', 'Project')
    const label = await create(`/projects/${project}/labels`, 'Label')
    const path = `/projects/${project}/labels/${label}/tags`
    const ancestors = [
      { collection: 'projects', id: project },
      { collection: 'labels', id: label },
    ]

    expect((await app.request(path)).status).toBe(200)
    const tag = await create(path, 'Tag')

    expect((await app.request(`${path}/${tag}`)).status).toBe(200)
    expect(
      (await app.request(`${path}/${tag}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Changed' }) }))
        .status,
    ).toBe(200)
    expect((await app.request(`${path}/${tag}`, { method: 'DELETE' })).status).toBe(409)
    expect((await app.request(`/tags/${tag}`)).status).toBe(200)
    expect(seen).toEqual([
      { collection: 'tags', target: { kind: 'collection' as const }, associations: ancestors },
      { collection: 'tags', target: { kind: 'collection' as const }, associations: ancestors },
      { collection: 'tags', target: { kind: 'resource' as const, id: tag }, associations: ancestors },
      { collection: 'tags', target: { kind: 'resource' as const, id: tag }, associations: ancestors },
      { collection: 'tags', target: { kind: 'resource' as const, id: tag }, associations: ancestors },
      { collection: 'tags', target: { kind: 'resource' as const, id: tag }, associations: [] },
    ])
    expect(seenAssociations).toEqual([ancestors, undefined])
  } finally {
    app.close()
    backend.close()
  }
})
