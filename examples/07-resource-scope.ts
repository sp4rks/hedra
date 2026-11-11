import type { Context } from 'hono'
import { z } from 'zod'

import type { Collection as CollectionType, QueryParams, ResourceScope } from '#hedra.ts'
import {
  BaseController,
  Collection,
  getResourceScope,
  Hedra,
  JsonApiResponse,
  Resource,
  SqliteBackend,
} from '#hedra.ts'

class ScopedController extends BaseController {
  private addressed: ResourceScope | undefined

  /** Records a resource address before applying the usual lookup checks. */
  override async id(context: Context, collection: CollectionType, id: string) {
    this.addressed = getResourceScope(context)

    return super.id(context, collection, id)
  }

  /** Records a collection address before applying the usual list checks. */
  override async list(context: Context, collection: CollectionType, baseUrl: string, params?: QueryParams) {
    this.addressed = getResourceScope(context)

    return super.list(context, collection, baseUrl, params)
  }

  /** Exposes an additional method with its inferred controller type. */
  lastScope(): ResourceScope | undefined {
    return this.addressed
  }
}

const Project = Resource.extend({ title: z.string(), notes: z.array(z.object({ text: z.string() })).default([]) })
const projects = new Collection('projects', Project, { controller: ScopedController })
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })

app.register(projects)

try {
  const created = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Launch', notes: [{ text: 'Review the draft' }] }),
  })
  const project = Project.parse(JsonApiResponse.parse(await created.json()).data)

  await app.request(`/projects/${project.id}`)
  // The custom controller reports a resource target containing this project's ID.
  projects.controller.lastScope()

  await app.request('/projects')
  // A list request reports a collection target with no resource ID.
  projects.controller.lastScope()
} finally {
  app.close()
  backend.close()
}
