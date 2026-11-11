import type { Context } from 'hono'
import assert from 'node:assert/strict'
import { z } from 'zod'

import type { Collection as CollectionType, ResourceScope } from '#hedra.ts'
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

  /** Records the generated address before applying the usual resource checks. */
  override async id(context: Context, collection: CollectionType, id: string) {
    this.addressed = getResourceScope(context)

    return super.id(context, collection, id)
  }

  /** Exposes an extra custom method with its inferred controller type. */
  lastScope(): ResourceScope | undefined {
    return this.addressed
  }
}

const Note = Resource.extend({ text: z.string() })
const Label = Resource.extend({
  name: z.string(),
  notes: z.array(Note).default([]),
  namedNotes: z.record(z.string(), Note).default({}),
  summary: Note.optional(),
})
const Project = Resource.extend({ title: z.string() })
const labels = new Collection('labels', Label, { controller: ScopedController })
const projects = new Collection('projects', Project, { controller: ScopedController, associations: [labels] })
const notes = new Collection('notes', Note, { parent: labels, controller: ScopedController })
const namedNotes = new Collection('namedNotes', Note, { parent: labels, controller: ScopedController })
const summary = new Collection('summary', Note, { parent: labels, controller: ScopedController })
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const headers = { 'content-type': 'application/json' }

app.register(projects)

try {
  const createdProject = await app.request('/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Launch' }),
  })
  const project = Project.parse(JsonApiResponse.parse(await createdProject.json()).data)

  assert.equal(createdProject.status, 201)
  assert.equal((await app.request(`/projects/${project.id}`)).status, 200)
  assert.deepEqual(projects.controller.lastScope(), {
    collection: 'projects',
    target: { kind: 'resource', id: project.id },
    associations: [],
  })

  // Associated resources retain their own UUID and storage; scope records the navigation ancestors.
  const createdLabel = await app.request(`/projects/${project.id}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Urgent',
      notes: [{ text: 'Review the draft' }],
      namedNotes: { 'release plan': { text: 'Keep it small' } },
      summary: { text: 'Ready for review' },
    }),
  })
  const label = Label.parse(JsonApiResponse.parse(await createdLabel.json()).data)
  const note = label.notes[0]
  const ancestors = [{ collection: 'projects', id: project.id }]
  const path = `/projects/${project.id}/labels/${label.id}`

  assert.equal(createdLabel.status, 201)
  assert(note)
  assert.equal((await app.request(`${path}/notes/${note.id}`)).status, 200)
  assert.deepEqual(notes.controller.lastScope(), {
    collection: 'notes',
    target: {
      kind: 'embedded',
      rootId: label.id,
      steps: [{ field: 'notes', kind: 'array', id: note.id }],
    },
    associations: ancestors,
  })

  // A decoded dictionary key selects the item; its stored UUID stays separate.
  const key = 'release plan'

  assert.equal((await app.request(`${path}/namedNotes/${encodeURIComponent(key)}`)).status, 200)
  assert.deepEqual(namedNotes.controller.lastScope(), {
    collection: 'namedNotes',
    target: {
      kind: 'embedded',
      rootId: label.id,
      steps: [{ field: 'namedNotes', kind: 'dictionary', key }],
    },
    associations: ancestors,
  })
  assert.notEqual(label.namedNotes[key]?.id, key)

  // The singleton field is its selector, so no item id or dictionary key appears.
  assert.equal((await app.request(`${path}/summary`)).status, 200)
  assert.deepEqual(summary.controller.lastScope(), {
    collection: 'summary',
    target: { kind: 'embedded', rootId: label.id, steps: [{ field: 'summary', kind: 'single' }] },
    associations: ancestors,
  })
  assert.equal((await app.request(`/labels/${label.id}/summary`)).status, 200)
  assert.deepEqual(summary.controller.lastScope(), {
    collection: 'summary',
    target: { kind: 'embedded', rootId: label.id, steps: [{ field: 'summary', kind: 'single' }] },
    associations: [],
  })
} finally {
  app.close()
  backend.close()
}
