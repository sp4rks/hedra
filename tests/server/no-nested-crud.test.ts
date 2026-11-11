import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Config, Hedra, JsonApiListResponse, Resource, ResourceScope, SqliteBackend } from '#hedra.ts'

const headers = { 'content-type': 'application/json' }

test('nested values use their model data and are replaced through the parent', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string() })
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note) }))
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'A',
  }

  try {
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ notes: [note] }) })
    const data = ((await created.json()) as { data: { id: string; notes: unknown[] } }).data

    expect(created.status).toBe(201)
    expect(data.notes).toEqual([note])
    const changed = { ...note, text: 'B', updatedAt: '2026-02-01T00:00:00.000Z' }
    const patched = await app.request(`/projects/${data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: [changed] }),
    })

    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { data: { notes: unknown[] } }).data.notes).toEqual([changed])

    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const body = method === 'POST' || method === 'PATCH' ? '{}' : undefined

      expect((await app.request(`/projects/${data.id}/notes`, { method, headers, body })).status).toBe(404)
      expect((await app.request(`/projects/${data.id}/notes/${note.id}`, { method, headers, body })).status).toBe(404)
    }
    const loaded = await app.request(`/projects/${data.id}`)

    expect(((await loaded.json()) as { data: { notes: unknown[] } }).data.notes).toEqual([changed])
    const duplicates = await app.request(`/projects/${data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: [changed, changed] }),
    })

    expect(duplicates.status).toBe(200)
    expect(((await duplicates.json()) as { data: { notes: unknown[] } }).data.notes).toEqual([changed, changed])
    const missing = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [{ text: 'C' }] }),
    })

    expect(missing.status).toBe(422)
  } finally {
    app.close()
    backend.close()
  }
})

test('parent writes validate cross-field rules involving nested data atomically', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const model = Resource.extend({
    limit: z.number(),
    values: z.array(z.number()),
  }).refine((value) => value.values.reduce((sum, item) => sum + item, 0) <= value.limit)

  try {
    app.register(new Collection('projects', model))
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit: 5, values: [1, 2] }),
    })
    const data = ((await created.json()) as { data: { id: string } }).data
    const invalid = await app.request(`/projects/${data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ values: [3, 4] }),
    })

    expect(created.status).toBe(201)
    expect(invalid.status).toBe(422)
    expect(((await (await app.request(`/projects/${data.id}`)).json()) as { data: unknown }).data).toEqual(data)
  } finally {
    app.close()
    backend.close()
  }
})

test('default controller preserves nested fields allowed by their schemas', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = z.looseObject({ text: z.string(), password: z.string() })
  const model = Resource.extend({ password: z.string(), notes: z.array(Note) }).loose()
  const projects = new Collection('projects', model)
  const note = { text: 'visible', password: 'nested-password', secret: 'nested-extra' }

  try {
    app.register(projects)
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ password: 'root-password', secret: 'root-extra', notes: [note] }),
    })
    const data = ((await created.json()) as { data: { id: string; notes: unknown[] } }).data

    expect(created.status).toBe(201)
    expect(data.notes).toEqual([note])
    expect(data).not.toHaveProperty('password')
    expect(data).not.toHaveProperty('secret')
    const loaded = await app.request(`/projects/${data.id}`)
    const listed = await app.request('/projects')

    expect(loaded.status).toBe(200)
    expect(((await loaded.json()) as { data: unknown }).data).toEqual(data)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { data: unknown[] }).data).toEqual([data])
    const changed = { ...note, text: 'updated', password: 'changed-password', secret: 'changed-extra' }
    const patched = await app.request(`/projects/${data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: [changed] }),
    })
    const updated = ((await patched.json()) as { data: Record<string, unknown> }).data

    expect(patched.status).toBe(200)
    expect(updated.notes).toEqual([changed])
    expect(updated).not.toHaveProperty('password')
    expect(updated).not.toHaveProperty('secret')
    const stored = (await backend.select('projects', { id: data.id }))[0]

    expect(stored?.password).toBe('root-password')
    expect(stored?.secret).toBe('root-extra')
    expect(stored?.notes).toEqual([changed])
  } finally {
    app.close()
    backend.close()
  }
})

test('tuple and intersection outputs preserve fields allowed by their schemas', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const model = Resource.extend({
    notes: z.tuple([Note]).rest(Note),
    selected: z.intersection(Note, z.object({ extra: z.string() })),
  })
  const fixed = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'fixed',
    password: 'private-fixed',
    secret: 'unknown-fixed',
  }
  const rest = { ...fixed, id: crypto.randomUUID(), text: 'rest', password: 'private-rest', secret: 'unknown-rest' }
  const selected = { ...fixed, extra: 'declared' }

  try {
    app.register(new Collection('projects', model))
    const response = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [fixed, rest], selected }),
    })
    const data = ((await response.json()) as { data: { id: string; notes: unknown[]; selected: unknown } }).data

    expect(response.status).toBe(201)
    expect(data.notes).toEqual([fixed, rest])
    expect(data.selected).toEqual(selected)
    const stored = (await backend.select('projects', { id: data.id }))[0]

    expect(stored?.notes).toEqual([fixed, rest])
    expect(stored?.selected).toEqual(selected)
  } finally {
    app.close()
    backend.close()
  }
})

test('explicit output schemas hide nested secrets on every resource response', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = z.looseObject({ text: z.string(), password: z.string() })
  const model = Resource.extend({ notes: z.array(Note) })
  const outputValidator = model.extend({ notes: z.array(Note.pick({ text: true }).strip()) })
  const note = { text: 'visible', password: 'private', secret: 'unknown' }

  try {
    app.register(new Collection('projects', model, { outputValidator }))
    const created = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ notes: [note] }) })
    const data = ((await created.json()) as { data: { id: string; notes: unknown[] } }).data

    expect(created.status).toBe(201)
    expect(data.notes).toEqual([{ text: 'visible' }])
    expect((await backend.select('projects', { id: data.id }))[0]?.notes).toEqual([note])
    const loaded = await app.request(`/projects/${data.id}`)
    const listed = await app.request('/projects')

    expect(loaded.status).toBe(200)
    expect(((await loaded.json()) as { data: unknown }).data).toEqual(data)
    expect(listed.status).toBe(200)
    expect(((await listed.json()) as { data: unknown[] }).data).toEqual([data])
    const changed = { ...note, text: 'updated', password: 'changed-private', secret: 'changed-unknown' }
    const patched = await app.request(`/projects/${data.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ notes: [changed] }),
    })

    expect(patched.status).toBe(200)
    expect(((await patched.json()) as { data: { notes: unknown[] } }).data.notes).toEqual([{ text: 'updated' }])
    expect((await backend.select('projects', { id: data.id }))[0]?.notes).toEqual([changed])
  } finally {
    app.close()
    backend.close()
  }
})

test('default output accepts ordinary nested unions and intersections', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = z.looseObject({ text: z.string(), password: z.string() })
  const dictionary = z.record(z.string(), z.string())
  const model = Resource.extend({
    choice: z.union([dictionary, Note]),
    selected: z.intersection(Note, dictionary),
  })
  const note = { text: 'visible', password: 'ordinary dictionary value', secret: 'unknown' }

  try {
    app.register(new Collection('projects', model))
    const response = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ choice: note, selected: note }),
    })
    const data = ((await response.json()) as { data: { id: string; choice: unknown; selected: unknown } }).data

    expect(response.status).toBe(201)
    expect(data.choice).toEqual(note)
    expect(data.selected).toEqual(note)
    const loaded = await app.request(`/projects/${data.id}`)

    expect(loaded.status).toBe(200)
    expect(((await loaded.json()) as { data: unknown }).data).toEqual(data)
  } finally {
    app.close()
    backend.close()
  }
})

test('shared schemas remain usable in multiple public union fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const choice = z.union([z.object({ first: Note, second: Note }), z.object({ text: z.string() })])
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }

  try {
    app.register(new Collection('projects', Resource.extend({ value: choice })))
    const response = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ value: { first: note, second: note } }),
    })
    const data = (
      (await response.json()) as {
        data: { value: { first: Record<string, unknown>; second: Record<string, unknown> } }
      }
    ).data

    expect(response.status).toBe(201)
    expect(data.value).toEqual({ first: note, second: note })
  } finally {
    app.close()
    backend.close()
  }
})

test('default output preserves finite recursive data', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Tree: z.ZodObject = z.object({
    name: z.string(),
    get children() {
      return z.array(Tree)
    },
  })

  try {
    app.register(new Collection('projects', Resource.extend({ tree: z.union([Tree, z.string()]) })))
    const leaf = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tree: { name: 'leaf', children: [] } }),
    })
    const child = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ tree: { name: 'root', children: [{ name: 'child', children: [] }] } }),
    })

    expect(leaf.status).toBe(201)
    expect(((await leaf.json()) as { data: { tree: unknown } }).data.tree).toEqual({ name: 'leaf', children: [] })
    expect(child.status).toBe(201)
    expect(((await child.json()) as { data: { tree: unknown } }).data.tree).toEqual({
      name: 'root',
      children: [{ name: 'child', children: [] }],
    })
    expect(await backend.select('projects')).toHaveLength(2)
  } finally {
    app.close()
    backend.close()
  }
})

test('dictionary keys are data while unsafe prototype keys cannot be silently lost', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })

  try {
    app.register(new Collection('projects', Resource.extend({ values: z.record(z.string(), z.string()) })))
    const rejected = await app.request('/projects', {
      method: 'POST',
      headers,
      body: '{"values":{"__proto__":"must not disappear"}}',
    })

    expect(rejected.status).toBe(422)
    expect(((await (await app.request('/projects')).json()) as { data: unknown[] }).data).toEqual([])
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ values: { '.': 'one', '..': 'two' } }),
    })

    expect(created.status).toBe(201)
    expect(((await created.json()) as { data: { values: unknown } }).data.values).toEqual({ '.': 'one', '..': 'two' })
    const storedId = crypto.randomUUID()
    const timestamp = '2026-01-01T00:00:00.000Z'
    const unsafeValues = JSON.parse('{"__proto__":"retained"}') as Record<string, string>

    await backend.insert('projects', {
      id: storedId,
      createdAt: timestamp,
      updatedAt: timestamp,
      values: unsafeValues,
    })
    const patch = await app.request(`/projects/${storedId}`, { method: 'PATCH', headers, body: '{}' })

    expect(patch.status).toBe(422)
    expect((await backend.select('projects', { id: storedId }))[0]?.values).toEqual(unsafeValues)
  } finally {
    app.close()
    backend.close()
  }
})

test('public scope and list schemas describe root resources only', () => {
  expect(ResourceScope.safeParse({ collection: 'projects', target: { kind: 'collection' } }).success).toBe(true)
  expect(
    ResourceScope.safeParse({ collection: 'projects', target: { kind: 'embedded', rootId: crypto.randomUUID() } })
      .success,
  ).toBe(false)
  expect(
    ResourceScope.safeParse({ collection: 'projects', target: { kind: 'collection' }, associations: [] }).success,
  ).toBe(false)
  expect(
    JsonApiListResponse.safeParse({ data: { first: {} }, links: { self: 'https://example.test/projects' } }).success,
  ).toBe(false)
})

test('obsolete parent collection options reject', () => {
  const project = new Collection('projects', Resource.extend({ name: z.string() }))

  expect(() => new Collection('notes', Resource, { parent: project } as never)).toThrow('configuration error')
})

test('ordinary nested schema wrappers accept Resource values', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const model = Resource.extend({
    payload: z.object({ note: Note }),
    choice: z.union([Note, z.string()]),
    lazy: z.lazy(() => Note),
  })
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'A',
    password: 'private',
    secret: 'unknown',
  }

  try {
    app.register(new Collection('projects', model))
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: { note }, choice: note, lazy: note }),
    })

    expect(created.status).toBe(201)
    const output = ((await created.json()) as { data: { payload: unknown; choice: unknown; lazy: unknown } }).data

    expect(output.payload).toEqual({ note })
    expect(output.choice).toEqual(note)
    expect(output.lazy).toEqual(note)
  } finally {
    app.close()
    backend.close()
  }
})

test('default output preserves nested wrappers and their fallback values', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }
  const model = Resource.extend({
    note: Note.readonly(),
    defaultNote: Note.default(note),
    catchNote: Note.catch(note),
    transformedNote: Note.transform((value) => value),
    preprocessedNote: z.preprocess((value) => value, Note),
  })

  try {
    app.register(new Collection('projects', model))
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ note, transformedNote: note, preprocessedNote: note }),
    })
    const data = ((await created.json()) as { data: Record<string, Record<string, unknown>> }).data

    expect(created.status).toBe(201)

    for (const field of ['note', 'defaultNote', 'catchNote', 'transformedNote', 'preprocessedNote']) {
      expect(data[field]).toEqual(note)
    }
    const storedId = crypto.randomUUID()
    const timestamp = '2026-01-01T00:00:00.000Z'

    await backend.insert('projects', {
      id: storedId,
      createdAt: timestamp,
      updatedAt: timestamp,
      note,
      catchNote: { invalid: true },
      transformedNote: note,
      preprocessedNote: note,
    })
    const loaded = await app.request(`/projects/${storedId}`)
    const fallback = ((await loaded.json()) as { data: Record<string, Record<string, unknown>> }).data

    expect(loaded.status).toBe(200)

    for (const field of ['defaultNote', 'catchNote']) {
      expect(fallback[field]).toEqual(note)
    }
  } finally {
    app.close()
    backend.close()
  }
})

test('association navigation and unlink routes are absent', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const labels = new Collection('labels', Resource.extend({ name: z.string() }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })

  try {
    app.register(projects)
    const project = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ title: 'A' }) })
    const label = await app.request('/labels', { method: 'POST', headers, body: JSON.stringify({ name: 'B' }) })
    const projectId = ((await project.json()) as { data: { id: string } }).data.id
    const labelId = ((await label.json()) as { data: { id: string } }).data.id

    await app.associations.link({ collection: 'projects', id: projectId }, { collection: 'labels', id: labelId })
    const requests: Array<[string, string]> = [
      ['GET', `/projects/${projectId}/labels`],
      ['POST', `/projects/${projectId}/labels`],
      ['GET', `/projects/${projectId}/labels/${labelId}`],
      ['PATCH', `/projects/${projectId}/labels/${labelId}`],
      ['DELETE', `/projects/${projectId}/labels/${labelId}`],
      ['DELETE', `/projects/${projectId}/associations/labels/${labelId}`],
    ]

    for (const [method, path] of requests) {
      expect(
        (await app.request(path, { method, headers, body: method === 'POST' || method === 'PATCH' ? '{}' : undefined }))
          .status,
      ).toBe(404)
    }
    expect(await app.associations.list({ collection: 'projects', id: projectId })).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})
