import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { QueryParams, ResourceInput, ResourceScope } from '#hedra.ts'
import { BaseController, Config, getResourceScope, Hedra, Resource, SqliteBackend } from '#hedra.ts'
import { request } from '../fixtures/scope.ts'

const headers = { 'content-type': 'application/json' }

test('root REST requests describe collection and UUID targets', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const seen: Array<ResourceScope | undefined> = []

  class ScopedController extends BaseController {
    /** Records the request scope before delegating resource creation. */
    override async create(context: Context, collection: z.ZodObject, input: ResourceInput) {
      seen.push(getResourceScope(context))

      return super.create(context, collection, input)
    }
    /** Records the request scope before delegating resource lookup. */
    override async id(context: Context, collection: z.ZodObject, id: string) {
      seen.push(getResourceScope(context))

      return super.id(context, collection, id)
    }
    /** Records the request scope before delegating resource listing. */
    override async list(context: Context, collection: z.ZodObject, baseUrl: string, params?: QueryParams) {
      seen.push(getResourceScope(context))

      return super.list(context, collection, baseUrl, params)
    }
    /** Records the request scope before delegating resource update. */
    override async update(context: Context, collection: z.ZodObject, input: ResourceInput, id: string) {
      seen.push(getResourceScope(context))

      return super.update(context, collection, input, id)
    }
    /** Records the request scope before delegating resource deletion. */
    override async delete(context: Context, collection: z.ZodObject, id: string) {
      seen.push(getResourceScope(context))

      return super.delete(context, collection, id)
    }
  }
  app.register(Resource.extend({ make: z.string() }).meta({ name: 'cars' }), { controller: ScopedController })

  try {
    expect((await request(app, '/cars')).status).toBe(200)
    const created = await request(app, '/cars', { method: 'POST', headers, body: JSON.stringify({ make: 'Toyota' }) })
    const body = (await created.json()) as { data: { id: string }; links: { self: string } }
    const id = body.data.id

    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toBe(body.links.self)
    expect((await request(app, `/cars/${id}`)).status).toBe(200)
    expect(
      (await request(app, `/cars/${id}`, { method: 'PATCH', headers, body: JSON.stringify({ make: 'Mazda' }) })).status,
    ).toBe(200)
    expect((await request(app, `/cars/${id}`, { method: 'DELETE' })).status).toBe(204)
    expect(seen).toEqual([
      { collection: 'cars', target: { kind: 'collection' as const } },
      { collection: 'cars', target: { kind: 'collection' as const } },
      { collection: 'cars', target: { kind: 'resource' as const, id } },
      { collection: 'cars', target: { kind: 'resource' as const, id } },
      { collection: 'cars', target: { kind: 'resource' as const, id } },
    ])
  } finally {
    app.close()
    backend.close()
  }
})
