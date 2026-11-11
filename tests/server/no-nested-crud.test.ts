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

test('default output hides nested passwords and unknown fields without changing stored data', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' }), backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const projects = new Collection('projects', Resource.extend({ notes: z.array(Note) }))
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unrecognised',
  }

  try {
    app.register(projects)
    const created = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ notes: [note] }) })
    const data = ((await created.json()) as { data: { id: string; notes: unknown[] } }).data

    expect(created.status).toBe(201)
    expect(data.notes).toEqual([{ id: note.id, createdAt: note.createdAt, updatedAt: note.updatedAt, text: 'visible' }])
    expect((await backend.select('projects', { id: data.id }))[0]?.notes).toEqual([note])
    const loaded = await app.request(`/projects/${data.id}`)

    expect(((await loaded.json()) as { data: { notes: unknown[] } }).data.notes).toEqual(data.notes)
  } finally {
    app.close()
    backend.close()
  }
})

test('tuple and intersection outputs hide private and undeclared fields while retaining stored values', async () => {
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
  const { password: _fixedPassword, secret: _fixedSecret, ...publicFixed } = fixed
  const { password: _restPassword, secret: _restSecret, ...publicRest } = rest

  try {
    app.register(new Collection('projects', model))
    const response = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [fixed, rest], selected }),
    })
    const data = ((await response.json()) as { data: { id: string; notes: unknown[]; selected: unknown } }).data

    expect(response.status).toBe(201)
    expect(data.notes).toEqual([publicFixed, publicRest])
    expect(data.selected).toEqual({ ...publicFixed, extra: 'declared' })
    const stored = (await backend.select('projects', { id: data.id }))[0]

    expect(stored?.notes).toEqual([fixed, rest])
    expect(stored?.selected).toEqual(selected)
  } finally {
    app.close()
    backend.close()
  }
})

test('ambiguous record intersections fail closed unless the public shape is explicit', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const app = new Hedra({ config, backend })
  const explicit = new Hedra({ config, backend })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const model = Resource.extend({ note: z.intersection(Note, z.record(z.string(), z.string())) })
  const output = Resource.extend({ note: Note.omit({ password: true }).strip() })
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }

  try {
    app.register(new Collection('projects', model))
    const rejected = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ note }) })

    expect(rejected.status).toBe(500)
    expect(await rejected.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(await backend.select('projects')).toEqual([])
    explicit.register(new Collection('projects', model, { outputValidator: output }))
    const created = await explicit.request('/projects', { method: 'POST', headers, body: JSON.stringify({ note }) })
    const data = ((await created.json()) as { data: { id: string; note: Record<string, unknown> } }).data

    expect(created.status).toBe(201)
    expect(data.note.password).toBeUndefined()
    expect(data.note.secret).toBeUndefined()
    expect((await backend.select('projects', { id: data.id }))[0]?.note).toEqual(note)
  } finally {
    app.close()
    explicit.close()
    backend.close()
  }
})

test('wrapped or opaque intersection branches fail closed for default output', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }
  const branches = [
    z.record(z.string(), z.string()).optional(),
    z.union([z.record(z.string(), z.string()), z.string()]),
    z.lazy(() => z.record(z.string(), z.string())),
    z.any(),
    z.unknown(),
  ]

  try {
    for (const branch of branches) {
      const app = new Hedra({ config, backend })
      const model = Resource.extend({ note: z.intersection(Note, branch) })

      try {
        app.register(new Collection('projects', model))
        const response = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ note }) })

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
        expect(await backend.select('projects')).toEqual([])
      } finally {
        app.close()
      }
    }
  } finally {
    backend.close()
  }
})

test('ambiguous unions fail closed without hiding ordinary dictionary keys', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }
  const record = z.record(z.string(), z.string())
  const choices = [
    z.union([record, Note]),
    z.union([Note, record]),
    z.union([z.any(), Note]),
    z.union([record.optional(), Note.readonly()]),
  ]

  try {
    for (const choice of choices) {
      const app = new Hedra({ config, backend })

      try {
        app.register(new Collection('projects', Resource.extend({ note: choice })))
        const response = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ note }) })

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
        expect(await backend.select('projects')).toEqual([])
      } finally {
        app.close()
      }
    }
    const app = new Hedra({ config, backend })

    try {
      app.register(new Collection('projects', Resource.extend({ values: z.union([record, z.string()]) })))
      const values = { password: 'ordinary dictionary value' }
      const response = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ values }) })

      expect(response.status).toBe(201)
      expect(((await response.json()) as { data: { values: unknown } }).data.values).toEqual(values)
    } finally {
      app.close()
    }
  } finally {
    backend.close()
  }
})

test('dynamic fields inside objects, arrays and tuples cannot bypass default output privacy', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
  const Note = Resource.extend({ text: z.string(), password: z.string() }).loose()
  const note = {
    id: crypto.randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    text: 'visible',
    password: 'private',
    secret: 'unknown',
  }
  const record = z.record(z.string(), z.string())
  const cases = [
    { schema: z.union([z.array(record), z.array(Note)]), value: [note] },
    { schema: z.union([z.object({ note: record }), z.object({ note: Note })]), value: { note } },
    { schema: z.union([z.tuple([record]), z.tuple([Note])]), value: [note] },
    { schema: z.union([z.tuple([z.string()]).rest(record), z.tuple([z.string()]).rest(Note)]), value: ['a', note] },
    {
      schema: z.intersection(z.object({ notes: z.array(record) }), z.object({ notes: z.array(Note) })),
      value: { notes: [note] },
    },
    { schema: z.intersection(z.tuple([record]), z.tuple([Note])), value: [note] },
  ]

  try {
    for (const { schema, value } of cases) {
      const app = new Hedra({ config, backend })

      try {
        app.register(new Collection('projects', Resource.extend({ value: schema })))
        const response = await app.request('/projects', { method: 'POST', headers, body: JSON.stringify({ value }) })

        expect(response.status).toBe(500)
        expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
        expect(await backend.select('projects')).toEqual([])
      } finally {
        app.close()
      }
    }
  } finally {
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
    expect(data.value.first.password).toBeUndefined()
    expect(data.value.first.secret).toBeUndefined()
    expect(data.value.second.password).toBeUndefined()
    expect(data.value.second.secret).toBeUndefined()
  } finally {
    app.close()
    backend.close()
  }
})

test('recursive object schemas fail closed without overflowing', async () => {
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
    expect(child.status).toBe(500)
    expect(await child.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(await backend.select('projects')).toHaveLength(1)
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
  const { password: _password, secret: _secret, ...visible } = note

  try {
    app.register(new Collection('projects', model))
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: { note }, choice: note, lazy: note }),
    })

    expect(created.status).toBe(201)
    const output = ((await created.json()) as { data: { payload: unknown; choice: unknown; lazy: unknown } }).data

    expect(output.payload).toEqual({ note: visible })
    expect(output.choice).toEqual(visible)
    expect(output.lazy).toEqual(visible)
  } finally {
    app.close()
    backend.close()
  }
})

test('default projection protects private fields through ordinary Zod wrappers', async () => {
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
      expect(data[field]?.password).toBeUndefined()
      expect(data[field]?.secret).toBeUndefined()
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
      expect(fallback[field]?.password).toBeUndefined()
      expect(fallback[field]?.secret).toBeUndefined()
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
