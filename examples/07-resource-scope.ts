// Read the addressed collection or resource from a custom REST controller.
// ResourceScope gives controller hooks a consistent address while BaseController handles normal CRUD.

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

  /** Captures the resource address before delegating the item read to BaseController. */
  override async id(context: Context, collection: CollectionType, id: string) {
    this.addressed = getResourceScope(context)

    return super.id(context, collection, id)
  }

  /** Captures the collection address while retaining BaseController's list validation and filtering. */
  override async list(context: Context, collection: CollectionType, baseUrl: string, params?: QueryParams) {
    this.addressed = getResourceScope(context)

    return super.list(context, collection, baseUrl, params)
  }

  /** Returns the last address observed by this controller. */
  lastScope(): ResourceScope | undefined {
    return this.addressed
  }
}

// Attach the custom controller to a project collection with ordinary nested notes.
const Project = Resource.extend({ title: z.string(), notes: z.array(z.object({ text: z.string() })).default([]) })
const projects = new Collection('projects', Project, { controller: ScopedController })
// Keep the example's data in a borrowed in-memory backend.
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })

// Registration constructs ScopedController and wires it into the generated routes.
app.register(projects)

try {
  // Create a project so the following item request has a concrete resource address.
  const created = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Launch', notes: [{ text: 'Review the draft' }] }),
  })
  const project = Project.parse(JsonApiResponse.parse(await created.json()).data)

  // An item request records a resource target containing this project's ID.
  await app.request(`/projects/${project.id}`)
  // The collection retains the custom controller's additional typed method.
  projects.controller.lastScope()

  // A list request records a collection target with no resource ID.
  await app.request('/projects')
  projects.controller.lastScope()
} finally {
  // Close the app's controllers, then release its borrowed backend.
  app.close()
  backend.close()
}
