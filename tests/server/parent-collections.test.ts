import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

import type { Collection as CollectionType, ResourceInput } from '#hedra.ts'
import { BaseController, Collection, Config, getResourceScope, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const headers = { 'content-type': 'application/json' }

test('parent-declared collections persist children inside their parent and expose only nested CRUD', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ title: z.string(), notes: z.array(Note).default([]) }))
  const notes = new Collection('notes', Note, { parent: projects })

  try {
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'One' }) })
    const project = (await created.json()) as { data: { id: string } }
    const path = `/projects/${project.data.id}/notes`
    const added = await app.request(path, { method: 'POST', headers, body: JSON.stringify({ text: 'First' }) })
    const note = (await added.json()) as { data: { id: string } }

    expect(added.status).toBe(201)
    expect((await app.request(`${path}/${note.data.id}`)).status).toBe(200)
    expect((await app.request('/notes')).status).toBe(404)
    expect(await backend.select(notes.name)).toEqual([])
    const parent = (await (await app.request(`/projects/${project.data.id}`)).json()) as {
      data: { notes: Array<{ id: string; text: string }> }
    }

    expect(parent.data.notes).toEqual([expect.objectContaining({ id: note.data.id, text: 'First' })])
    expect(
      (
        await app.request(`${path}/${note.data.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ text: 'Next' }),
        })
      ).status,
    ).toBe(200)
    expect((await app.request(`${path}/${note.data.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`${path}/${note.data.id}`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('contained collection names match the parent field name including capitals', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ namedNotes: z.record(z.string(), Note).default({}) }))
  const notes = new Collection('namedNotes', Note, { parent: projects })

  try {
    app.register(notes)
    const created = await app.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const note = await app.request(`/projects/${id}/namedNotes?key=alpha`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(note.status).toBe(201)
    expect((await app.request(`/projects/${id}/namedNotes/alpha`)).status).toBe(200)
  } finally {
    app.close()
    backend.close()
  }
})

test('contained collections may reuse a field name under different parents', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Task = Resource.extend({ text: z.string() })
  const Note = Resource.extend({ tasks: z.array(Task).default([]) })
  const projects = new Collection(
    'projects',
    Resource.extend({ notes: z.array(Note).default([]), summary: Note.optional() }),
  )
  const notes = new Collection('notes', Note, { parent: projects })
  const summary = new Collection('summary', Note, { parent: projects })

  new Collection('tasks', Task, { parent: notes })
  new Collection('tasks', Task, { parent: summary })
  try {
    app.register(projects)
    const project = await app.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await project.json()) as { data: { id: string } }).data.id
    const createdSummary = await app.request(`/projects/${id}/summary`, { method: 'POST', headers, body: '{}' })
    const task = await app.request(`/projects/${id}/summary/tasks`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello' }),
    })

    expect(createdSummary.status).toBe(201)
    expect(task.status).toBe(201)
  } finally {
    app.close()
    backend.close()
  }
})

test('undeclared Resource fields do not collide with associated collection routes', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Label = Resource.extend({ name: z.string() })
  const labels = new Collection('labels', Label)
  const projects = new Collection('projects', Resource.extend({ labels: z.array(Label).default([]) }), {
    associations: [labels],
  })

  try {
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const response = await app.request(`/projects/${id}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'linked' }),
    })

    expect(response.status).toBe(201)
    expect((await app.associations.list({ collection: 'projects', id })).length).toBe(1)
  } finally {
    app.close()
    backend.close()
  }
})

test('reading child declarations cannot change routes or controller attachment', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))
  const notes = new Collection('notes', Note, { parent: projects })
  const children = projects.children as Collection[]

  try {
    children.length = 0
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await created.json()) as { data: { id: string } }).data.id

    expect((await app.request(`/projects/${id}/notes`)).status).toBe(200)
    expect(notes.controller).toBeDefined()
  } finally {
    app.close()
    backend.close()
  }
})

test('contained controller rejects a scope that identifies a different parent', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))
  const otherId = crypto.randomUUID()

  class TamperingController extends BaseController {
    /** Attempts a contained mutation after changing the public scope. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      const scope = getResourceScope(context)

      if (scope?.target.kind === 'embedded') {
        context.set('hedraResourceScope' as never, { ...scope, target: { ...scope.target, rootId: otherId } } as never)
      }

      return await super.create(context, collection, input)
    }
  }
  new Collection('notes', Note, { parent: projects, controller: TamperingController })
  try {
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const response = await app.request(`/projects/${id}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'must not persist' }),
    })

    expect(response.status).toBe(422)
    expect(
      ((await (await app.request(`/projects/${id}`)).json()) as { data: { notes: unknown[] } }).data.notes,
    ).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('contained controller calls without parent scope cannot create child records', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))
  const notes = new Collection('notes', Note, { parent: projects })

  try {
    app.register(projects)
    app.post('/direct', async (context) => {
      await expect(notes.controller.create(context, notes, { text: 'invalid' })).rejects.toThrow('parent scope')

      return context.body(null, 204)
    })
    expect((await app.request('/direct', { method: 'POST' })).status).toBe(204)
    expect(await backend.select('notes')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('failed child controller construction leaves the whole collection tree reusable', () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))
  let fail = true

  class NoteController extends BaseController {
    /** Rejects the first construction to exercise registration cleanup. */
    constructor(...args: ConstructorParameters<typeof BaseController>) {
      super(...args)
      if (fail) throw new Error('constructor failed')
    }
  }
  const notes = new Collection('notes', Note, { parent: projects, controller: NoteController })

  try {
    expect(() => app.register(projects)).toThrow('constructor failed')
    expect(() => projects.controller).toThrow('registered')
    expect(() => notes.controller).toThrow('registered')
    fail = false
    app.register(notes)
    expect(projects.controller).toBeDefined()
    expect(notes.controller).toBeInstanceOf(NoteController)
  } finally {
    app.close()
    backend.close()
  }
})

test('parent declarations validate their field and cannot be added after attachment', () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const Other = Resource.extend({ name: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))

  try {
    expect(() => new Collection('missing', Note, { parent: projects })).toThrow('Parent field')
    expect(() => new Collection('notes', Other, { parent: projects })).toThrow('Parent field')
    expect(() => new Collection('notes', Note, { parent: projects, outputValidator: Note })).toThrow('Parent controls')
    const notes = new Collection('notes', Note, { parent: projects })

    expect(() => new Collection('notes', Note, { parent: projects })).toThrow('Duplicate child')
    expect(() => new Collection('other', Other, { associations: [notes] })).toThrow('Contained collections')
    expect(() => new Collection('missing', Note, { parent: projects, associations: [projects] })).toThrow()
    app.register(projects)
    expect(() => new Collection('notes', Note, { parent: projects })).toThrow('already attached')
    expect(() => app.register(notes)).toThrow('already registered')
  } finally {
    app.close()
    backend.close()
  }
})

test('Resource fields have no generated routes until a child collection is declared', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note).default([]) }))

  try {
    app.register(projects)
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [{ text: 'stored' }] }),
    })
    const project = ((await created.json()) as { data: { id: string; notes: Array<{ text: string }> } }).data

    expect(project.notes[0]?.text).toBe('stored')
    expect((await app.request(`/projects/${project.id}/notes`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('contained resource identities and data survive reopening the backend', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'hedra-contained-'))
  const path = join(directory, 'data.sqlite')
  const Note = Resource.extend({ text: z.string() })
  const Project = Resource.extend({ notes: z.array(Note).default([]) })
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const firstBackend = new SqliteBackend(path)
  const first = new Hedra({ config, backend: firstBackend })
  const firstProjects = new Collection('projects', Project)

  new Collection('notes', Note, { parent: firstProjects })
  try {
    first.register(firstProjects)
    const created = await first.request('/projects', { method: 'POST', headers, body: '{}' })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const response = await first.request(`/projects/${id}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'persistent' }),
    })
    const child = ((await response.json()) as { data: { id: string; text: string } }).data

    expect(response.status).toBe(201)
    first.close()
    firstBackend.close()

    const secondBackend = new SqliteBackend(path)
    const second = new Hedra({ config, backend: secondBackend })
    const secondProjects = new Collection('projects', Project)

    new Collection('notes', Note, { parent: secondProjects })
    try {
      second.register(secondProjects)
      const loaded = await second.request(`/projects/${id}/notes/${child.id}`)

      expect(loaded.status).toBe(200)
      expect(((await loaded.json()) as { data: unknown }).data).toEqual(child)
    } finally {
      second.close()
      secondBackend.close()
    }
  } finally {
    first.close()
    firstBackend.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
