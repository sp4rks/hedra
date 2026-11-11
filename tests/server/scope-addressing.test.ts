import type { Context } from 'hono'
import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Collection as CollectionType, QueryParams, ResourceInput, ResourceScope } from '#hedra.ts'
import {
  BaseController,
  Collection,
  Config,
  getAssociationScope,
  getEmbeddedScope,
  getResourceScope,
  Hedra,
  Resource,
  ResourceScope as ScopeSchema,
  SqliteBackend,
} from '#hedra.ts'

const headers = { 'content-type': 'application/json' }

type Capture = {
  resource: ResourceScope | undefined
  embedded: ReturnType<typeof getEmbeddedScope>
  associations: ReturnType<typeof getAssociationScope>
}

/** Provides generated routes with nested embedded and association paths. */
async function fixture(mutate?: (context: Context) => void) {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const seen: Capture[] = []
  /** Applies an optional mutation and records the public scope views. */
  const capture = (context: Context) => {
    mutate?.(context)
    seen.push({
      resource: getResourceScope(context),
      embedded: getEmbeddedScope(context),
      associations: getAssociationScope(context),
    })
  }

  class ScopedController extends BaseController {
    /** Records the request scope before delegating resource creation. */
    override async create(context: Context, collection: CollectionType, input: ResourceInput) {
      capture(context)

      return super.create(context, collection, input)
    }
    /** Records the request scope before delegating resource lookup. */
    override async id(context: Context, collection: CollectionType, id: string) {
      capture(context)

      return super.id(context, collection, id)
    }
    /** Records the request scope before delegating resource listing. */
    override async list(context: Context, collection: CollectionType, url: string, params?: QueryParams) {
      capture(context)

      return super.list(context, collection, url, params)
    }
    /** Records the request scope before delegating resource update. */
    override async update(context: Context, collection: CollectionType, input: ResourceInput, id: string) {
      capture(context)

      return super.update(context, collection, input, id)
    }
    /** Records the request scope before delegating resource deletion. */
    override async delete(context: Context, collection: CollectionType, id: string) {
      capture(context)

      return super.delete(context, collection, id)
    }
  }
  const Task = Resource.extend({ text: z.string() })
  const Note = Resource.extend({ text: z.string(), tasks: z.array(Task).default([]) })
  const Details = Resource.extend({ named: z.record(z.string(), Note).default({}) })
  const Group = Resource.extend({ name: z.string(), details: Details.optional() })
  const Tag = Resource.extend({
    name: z.string(),
    notes: z.array(Note).default([]),
    named: z.record(z.string(), Note).default({}),
    summary: Note.optional(),
    groups: z.array(Group).default([]),
  })
  const tags = new Collection('tags', Tag, { controller: ScopedController })
  const notes = new Collection('notes', Note, { parent: tags, controller: ScopedController })
  const named = new Collection('named', Note, { parent: tags, controller: ScopedController })
  const summary = new Collection('summary', Note, { parent: tags, controller: ScopedController })
  const groups = new Collection('groups', Group, { parent: tags, controller: ScopedController })
  const details = new Collection('details', Details, { parent: groups, controller: ScopedController })
  const namedDetails = new Collection('named', Note, { parent: details, controller: ScopedController })

  for (const parent of [notes, named, summary, namedDetails]) {
    new Collection('tasks', Task, { parent, controller: ScopedController })
  }
  const labels = new Collection('labels', Resource.extend({ name: z.string() }), { associations: [tags] })
  const projects = new Collection('projects', Resource.extend({ name: z.string() }), { associations: [labels] })
  /** Creates a resource through its generated route and returns its ID. */
  const create = async (path: string, value: object) => {
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify(value) })

    expect(response.status).toBe(201)

    return ((await response.json()) as { data: { id: string } }).data.id
  }

  app.register(projects)
  const project = await create('/projects', { name: 'Project' })
  const label = await create(`/projects/${project}/labels`, { name: 'Label' })
  const tag = await create(`/projects/${project}/labels/${label}/tags`, { name: 'Tag' })

  seen.length = 0

  return { app, backend, create, project, label, tag, seen }
}

test('dictionary requests expose validated keys rather than resource UUIDs', async () => {
  const { app, backend, tag, seen } = await fixture()
  const path = `/tags/${tag}/named`

  try {
    expect((await app.request(path)).status).toBe(200)
    const created = await app.request(`${path}?key=release%20plan`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'hello' }),
    })
    const id = ((await created.json()) as { data: { id: string } }).data.id

    expect(created.status).toBe(201)
    expect(id).not.toBe('release plan')
    expect((await app.request(`${path}/release%20plan`)).status).toBe(200)
    expect(
      (
        await app.request(`${path}/release%20plan`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ text: 'changed' }),
        })
      ).status,
    ).toBe(200)
    expect((await app.request(`${path}/release%20plan`, { method: 'DELETE' })).status).toBe(204)
    expect(seen.map((item) => item.resource)).toEqual([
      {
        collection: 'named',
        target: { kind: 'embedded' as const, rootId: tag, steps: [{ field: 'named', kind: 'dictionary' as const }] },
        associations: [],
      },
      ...Array.from({ length: 4 }, () => ({
        collection: 'named',
        target: {
          kind: 'embedded' as const,
          rootId: tag,
          steps: [{ field: 'named', kind: 'dictionary' as const, key: 'release plan' }],
        },
        associations: [],
      })),
    ])
  } finally {
    app.close()
    backend.close()
  }
})

test('singleton requests identify their field without an id or key', async () => {
  const { app, backend, tag, seen } = await fixture()
  const path = `/tags/${tag}/summary`

  try {
    expect((await app.request(path, { method: 'POST', headers, body: JSON.stringify({ text: 'hello' }) })).status).toBe(
      201,
    )
    expect((await app.request(path)).status).toBe(200)
    expect(
      (await app.request(path, { method: 'PATCH', headers, body: JSON.stringify({ text: 'changed' }) })).status,
    ).toBe(200)
    expect(
      (await app.request(`${path}/tasks`, { method: 'POST', headers, body: JSON.stringify({ text: 'nested' }) }))
        .status,
    ).toBe(201)
    expect((await app.request(path, { method: 'DELETE' })).status).toBe(204)
    const single = { field: 'summary', kind: 'single' as const }
    const expected = {
      collection: 'summary',
      target: { kind: 'embedded' as const, rootId: tag, steps: [single] },
      associations: [],
    }

    expect(seen.map((item) => item.resource)).toEqual([
      expected,
      expected,
      expected,
      {
        collection: 'tasks',
        target: { kind: 'embedded' as const, rootId: tag, steps: [single, { field: 'tasks', kind: 'array' as const }] },
        associations: [],
      },
      expected,
    ])
  } finally {
    app.close()
    backend.close()
  }
})

test('association and embedded traversal compose in one data-only scope', async () => {
  const { app, backend, create, project, label, tag, seen } = await fixture()
  const path = `/projects/${project}/labels/${label}/tags/${tag}`

  try {
    const group = await create(`${path}/groups`, {
      name: 'Group',
      details: { named: { 'release plan': { text: 'Note' } } },
    })
    const task = await create(`${path}/groups/${group}/details/named/release%20plan/tasks`, { text: 'Task' })
    const target = `${path}/groups/${group}/details/named/release%20plan/tasks/${task}`

    seen.length = 0
    expect((await app.request(target)).status).toBe(200)
    const steps = [
      { field: 'groups', kind: 'array' as const, id: group },
      { field: 'details', kind: 'single' as const },
      { field: 'named', kind: 'dictionary' as const, key: 'release plan' },
      { field: 'tasks', kind: 'array' as const, id: task },
    ]
    const associations = [
      { collection: 'projects', id: project },
      { collection: 'labels', id: label },
    ]
    const expected = { collection: 'tasks', target: { kind: 'embedded' as const, rootId: tag, steps }, associations }

    expect(seen).toEqual([{ resource: expected, embedded: { rootId: tag, steps }, associations }])
    expect(structuredClone(seen[0]?.resource)).toEqual(expected)
    expect(JSON.parse(JSON.stringify(seen[0]?.resource))).toEqual(expected)
  } finally {
    app.close()
    backend.close()
  }
})

test('public accessors return only documented detached data', async () => {
  const { app, backend, create, project, label, tag, seen } = await fixture((context) => {
    const scope = getResourceScope(context)

    if (!scope) return
    scope.associations.length = 0
    if (scope.target.kind === 'embedded' && scope.target.steps[0]) scope.target.steps[0].field = 'changed'
    const embedded = getEmbeddedScope(context)

    if (embedded?.steps[0]) embedded.steps[0].field = 'changed'
    const associations = getAssociationScope(context)

    if (associations) associations.length = 0
  })

  try {
    const note = await create(`/tags/${tag}/notes`, { text: 'Note' })
    const path = `/projects/${project}/labels/${label}/tags/${tag}/notes/${note}`

    seen.length = 0
    expect((await app.request(path)).status).toBe(200)
    const steps = [{ field: 'notes', kind: 'array' as const, id: note }]
    const associations = [
      { collection: 'projects', id: project },
      { collection: 'labels', id: label },
    ]
    const expected = { collection: 'notes', target: { kind: 'embedded' as const, rootId: tag, steps }, associations }

    expect(seen).toEqual([{ resource: expected, embedded: { rootId: tag, steps }, associations }])
    const other = await create('/projects', { name: 'Other' })

    expect((await app.request(`/projects/${other}/labels/${label}/tags/${tag}/notes/${note}`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('scope schemas reject invalid addressing combinations', async () => {
  const rootId = crypto.randomUUID()
  /** Builds an embedded scope candidate for validation. */
  const target = (steps: unknown[]) => ({
    collection: 'tags',
    target: { kind: 'embedded' as const, rootId, steps },
    associations: [],
  })
  const malformed = [
    target([]),
    target([{ field: 'notes', kind: 'array' as const, id: 'not-a-uuid' }]),
    target([{ field: 'notes', kind: 'array' as const, key: 'key' }]),
    target([{ field: 'named', kind: 'dictionary' as const, id: rootId }]),
    target([{ field: 'summary', kind: 'single' as const, id: rootId }]),
    target([{ field: 'named', kind: 'dictionary' as const, key: '__proto__' }]),
    target([{ field: 'named', kind: 'dictionary' as const, key: '' }]),
    target([
      { field: 'notes', kind: 'array' as const },
      { field: 'summary', kind: 'single' as const },
    ]),
    target([
      { field: 'named', kind: 'dictionary' as const },
      { field: 'summary', kind: 'single' as const },
    ]),
    target([{ field: 'notes', kind: 'array' as const, model: z.object({}) }]),
  ]

  for (const value of malformed) expect(ScopeSchema.safeParse(value).success).toBe(false)
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })

  try {
    app.get('/custom', (context) =>
      context.json({
        resource: getResourceScope(context) ?? null,
        embedded: getEmbeddedScope(context) ?? null,
        associations: getAssociationScope(context) ?? null,
      }),
    )
    expect(await (await app.request('/custom')).json()).toEqual({ resource: null, embedded: null, associations: null })
  } finally {
    app.close()
    backend.close()
  }
})

test('invalid generated selectors reject before custom controller dispatch', async () => {
  const { app, backend, tag, seen } = await fixture()

  try {
    expect((await app.request('/tags/not-a-uuid')).status).toBe(422)
    expect((await app.request(`/tags/${tag}/notes/not-a-uuid`)).status).toBe(422)
    expect(
      (
        await app.request(`/tags/${tag}/named?key=__proto__`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'bad' }),
        })
      ).status,
    ).toBe(422)
    expect(seen).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('ownership and complete association checks survive scope projection', async () => {
  const { app, backend, create, project, label, tag } = await fixture()

  try {
    const otherProject = await create('/projects', { name: 'Other project' })
    const otherTag = await create('/tags', { name: 'Other tag' })
    const note = await create(`/tags/${tag}/notes`, { text: 'Owned note' })

    expect((await app.request(`/tags/${otherTag}/notes/${note}`)).status).toBe(404)
    expect((await app.request(`/projects/${otherProject}/labels/${label}/tags/${tag}/notes/${note}`)).status).toBe(404)
    const failed = await app.request(`/projects/${project}/labels/${label}/tags/${otherTag}/notes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: 'Must not persist' }),
    })

    expect(failed.status).toBe(404)
    const notes = await app.request(`/tags/${otherTag}/notes`)

    expect(((await notes.json()) as { data: unknown[] }).data).toEqual([])
    const links = await app.associations.list({ collection: 'labels', id: label })

    expect(links).toHaveLength(2)
    expect(links.some((link) => link.target.collection === 'tags' && link.target.id === otherTag)).toBe(false)
  } finally {
    app.close()
    backend.close()
  }
})
