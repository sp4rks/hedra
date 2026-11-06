import { expect, setSystemTime, test } from 'bun:test'
import { z } from 'zod'

import { Collection, EmbeddedResource, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('registration exposes validated resource CRUD routes', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const cars = new Collection(
    'cars',
    Resource.extend({ make: z.string().trim().min(1), year: z.number().default(2024) }),
  )

  try {
    app.register(cars)
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: ' Toyota ' }),
    })
    const body = (await created.json()) as { data: { id: string; make: string; year: number } }

    expect(created.status).toBe(201)
    expect(body.data).toMatchObject({ make: 'Toyota', year: 2024 })
    expect(created.headers.get('location')).toContain(`/cars/${body.data.id}`)
    expect((await app.request(`/cars/${body.data.id}`)).status).toBe(200)
    expect((await app.request('/cars')).status).toBe(200)
    const updated = await app.request(`/cars/${body.data.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Honda' }),
    })

    expect(((await updated.json()) as { data: unknown }).data).toMatchObject({ make: 'Honda', year: 2024 })
    expect((await app.request(`/cars/${body.data.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/cars/${body.data.id}`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('parent creation prepares embedded items and keeps their metadata server-owned', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string().trim().min(1) })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })

  try {
    app.register(new Collection('cars', Car))
    const response = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', notes: [{ id: 'spoof', text: ' test ' }] }),
    })
    const body = (await response.json()) as { data: { notes: Array<{ id: string; text: string; createdAt: string }> } }

    expect(response.status).toBe(201)
    expect(body.data.notes).toHaveLength(1)
    expect(body.data.notes[0]?.text).toBe('test')
    expect(body.data.notes[0]?.id).not.toBe('spoof')
    expect(z.uuid().safeParse(body.data.notes[0]?.id).success).toBe(true)
    expect(z.iso.datetime().safeParse(body.data.notes[0]?.createdAt).success).toBe(true)
  } finally {
    app.close()
    backend.close()
  }
})

test('nested array routes address only the owning resource and update one item', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string().min(1) })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })
  const create = async (make: string) => {
    const response = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make }),
    })

    return ((await response.json()) as { data: { id: string } }).data.id
  }

  try {
    app.register(new Collection('cars', Car))
    const first = await create('Toyota')
    const second = await create('Honda')
    const response = await app.request(`/cars/${first}/notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'first' }),
    })
    const note = ((await response.json()) as { data: { id: string; text: string } }).data

    expect(response.status).toBe(201)
    expect((await app.request(`/cars/${first}/notes/${note.id}`)).status).toBe(200)
    expect((await app.request(`/cars/${second}/notes/${note.id}`)).status).toBe(404)
    const changed = await app.request(`/cars/${first}/notes/${note.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'changed' }),
    })

    expect(((await changed.json()) as { data: { text: string } }).data.text).toBe('changed')
    expect((await app.request(`/cars/${first}/notes/${note.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/cars/${first}/notes/${note.id}`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('dictionary and singleton routes preserve keys and owned identities', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const Car = Resource.extend({
    make: z.string(),
    namedNotes: z.record(z.string(), Note).default({}),
    summary: Note.optional(),
  })

  try {
    app.register(new Collection('cars', Car))
    const response = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota' }),
    })
    const car = ((await response.json()) as { data: { id: string } }).data
    const created = await app.request(`/cars/${car.id}/namedNotes?key=${encodeURIComponent('service/one')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Service' }),
    })

    expect(created.status).toBe(201)
    expect(created.headers.get('location')).toEndWith('/namedNotes/service%2Fone')
    const item = ((await created.json()) as { data: { id: string } }).data
    const listed = await app.request(`/cars/${car.id}/namedNotes`)

    expect(((await listed.json()) as { data: Record<string, { id: string }> }).data['service/one']?.id).toBe(item.id)
    expect((await app.request(`/cars/${car.id}/namedNotes/service%2Fone`)).status).toBe(200)
    const proto = await app.request(`/cars/${car.id}/namedNotes?key=__proto__`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Safe' }),
    })

    expect(proto.status).toBe(422)
    expect((await app.request(`/cars/${car.id}/namedNotes/__proto__`)).status).toBe(422)
    const summary = await app.request(`/cars/${car.id}/summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Summary' }),
    })

    expect(summary.status).toBe(201)
    expect((await app.request(`/cars/${car.id}/summary`)).status).toBe(200)
    expect((await app.request(`/cars/${car.id}/summary`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/cars/${car.id}/summary`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('parent container replacement preserves addressed identities and rejects foreign ones atomically', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string().min(1) })
  const Car = Resource.extend({
    make: z.string(),
    notes: z.array(Note).default([]),
    namedNotes: z.record(z.string(), Note).default({}),
  })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        make: 'Toyota',
        notes: [{ text: 'one' }, { text: 'two' }],
        namedNotes: { first: { text: 'named' } },
      }),
    })
    const car = (
      (await created.json()) as {
        data: { id: string; notes: Array<{ id: string }>; namedNotes: Record<string, { id: string }> }
      }
    ).data
    const oldId = car.notes[0]?.id
    const namedId = car.namedNotes.first?.id
    const update = await app.request(`/cars/${car.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        notes: [{ id: oldId, text: 'changed' }, { text: 'new' }],
        namedNotes: { renamed: { id: namedId, text: 'renamed' } },
      }),
    })
    const changed = ((await update.json()) as { data: typeof car }).data

    expect(update.status).toBe(200)
    expect(changed.notes[0]?.id).toBe(oldId)
    expect(changed.notes[1]?.id).not.toBe(car.notes[1]?.id)
    expect(changed.namedNotes.renamed?.id).toBe(namedId)
    const invalid = await app.request(`/cars/${car.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ make: 'wrong', notes: [{ id: crypto.randomUUID(), text: 'foreign' }] }),
    })

    expect(invalid.status).toBe(422)
    expect(((await (await app.request(`/cars/${car.id}`)).json()) as { data: unknown }).data).toEqual(changed)
  } finally {
    app.close()
    backend.close()
  }
})

test('parent dictionary input rejects unsafe keys without changing the resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const Car = Resource.extend({ make: z.string(), namedNotes: z.record(z.string(), Note).default({}) })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', { method: 'POST', headers, body: JSON.stringify({ make: 'Toyota' }) })
    const car = ((await created.json()) as { data: { id: string } }).data
    const invalid = await app.request(`/cars/${car.id}`, {
      method: 'PATCH',
      headers,
      body: '{"make":"bad","namedNotes":{"__proto__":{"text":"unsafe"}}}',
    })

    expect(invalid.status).toBe(422)
    expect(((await (await app.request(`/cars/${car.id}`)).json()) as { data: unknown }).data).toEqual(car)
  } finally {
    app.close()
    backend.close()
  }
})

test('generated routes distinguish client errors from failed output validation', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Car = Resource.extend({ make: z.string().trim().min(1), year: z.number() })
  const output = z.object({ id: z.uuid(), make: z.string(), year: z.number() }).refine(() => false)

  try {
    app.register(new Collection('cars', Car, { outputValidator: output }))
    const missingType = await app.request('/cars', { method: 'POST', body: '{}' })
    const malformed = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    const invalid = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: '', year: 1 }),
    })
    const outputFailure = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', year: 1 }),
    })

    expect(missingType.status).toBe(415)
    expect(malformed.status).toBe(400)
    expect(invalid.status).toBe(422)
    expect(outputFailure.status).toBe(500)
    expect(await outputFailure.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(((await (await app.request('/cars')).json()) as { data: unknown[] }).data).toEqual([])
    expect((await app.request('/cars/not-a-uuid')).status).toBe(422)
    expect((await app.request('/cars?sort=make')).status).toBe(422)
  } finally {
    app.close()
    backend.close()
  }
})

test('unknown literal filter keys cannot silently select every resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })

  try {
    app.register(new Collection('cars', Resource.extend({ make: z.string() })))
    const filter = encodeURIComponent('{"__proto__":"secret"}')

    expect((await app.request(`/cars?filter=${filter}`)).status).toBe(422)
  } finally {
    app.close()
    backend.close()
  }
})

test('nested deletion preserves required singletons and minimum-sized containers', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).min(1), summary: Note })

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', notes: [{ text: 'only' }], summary: { text: 'required' } }),
    })
    const car = ((await created.json()) as { data: { id: string; notes: Array<{ id: string }> } }).data

    expect((await app.request(`/cars/${car.id}/notes/${car.notes[0]?.id}`, { method: 'DELETE' })).status).toBe(422)
    expect((await app.request(`/cars/${car.id}/summary`, { method: 'DELETE' })).status).toBe(422)
    expect(((await (await app.request(`/cars/${car.id}`)).json()) as { data: unknown }).data).toEqual(car)
  } finally {
    app.close()
    backend.close()
  }
})

test('embedded mutations update ancestor timestamps without changing siblings', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })
  const headers = { 'content-type': 'application/json' }

  try {
    setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers,
      body: JSON.stringify({ make: 'Toyota', notes: [{ text: 'one' }, { text: 'two' }] }),
    })
    const car = (
      (await created.json()) as {
        data: { id: string; updatedAt: string; notes: Array<{ id: string; createdAt: string; updatedAt: string }> }
      }
    ).data
    const original = car.notes[0]

    if (!original) throw new Error('Expected an embedded note')

    setSystemTime(new Date('2026-01-01T00:01:00.000Z'))
    const changed = await app.request(`/cars/${car.id}/notes/${original.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ text: 'changed' }),
    })
    const note = ((await changed.json()) as { data: { id: string; createdAt: string; updatedAt: string } }).data
    const root = ((await (await app.request(`/cars/${car.id}`)).json()) as { data: typeof car }).data

    expect(note.id).toBe(original.id)
    expect(note.createdAt).toBe(original.createdAt)
    expect(note.updatedAt).toBe('2026-01-01T00:01:00.000Z')
    expect(root.updatedAt).toBe(note.updatedAt)
    expect(root.notes[1]).toEqual(car.notes[1])
  } finally {
    setSystemTime()
    app.close()
    backend.close()
  }
})

test('embedded output follows the owner policy without leaking nested passwords', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string(), password: z.string() })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', notes: [{ text: 'public', password: 'secret' }] }),
    })
    const car = ((await created.json()) as { data: { id: string; notes: Array<{ id: string; password?: string }> } })
      .data

    expect(car.notes[0]?.password).toBeUndefined()
    const direct = await app.request(`/cars/${car.id}/notes/${car.notes[0]?.id}`)

    expect(((await direct.json()) as { data: { password?: string } }).data.password).toBeUndefined()
    expect((await backend.select('cars'))[0]?.notes).toMatchObject([{ password: 'secret' }])
  } finally {
    app.close()
    backend.close()
  }
})

test('embedded fields excluded by explicit output policy have no generated route', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })
  const output = Car.omit({ notes: true })

  try {
    app.register(new Collection('cars', Car, { outputValidator: output }))
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', notes: [{ text: 'hidden' }] }),
    })
    const car = ((await created.json()) as { data: { id: string; notes?: unknown } }).data

    expect(car.notes).toBeUndefined()
    expect((await app.request(`/cars/${car.id}/notes`)).status).toBe(404)
  } finally {
    app.close()
    backend.close()
  }
})

test('create applies model cross-field refinements before writing a resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Car = Resource.extend({ start: z.number(), end: z.number() }).refine((value) => value.end > value.start)

  try {
    app.register(new Collection('cars', Car))
    const invalid = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start: 10, end: 1 }),
    })

    expect(invalid.status).toBe(422)
    expect(((await (await app.request('/cars')).json()) as { data: unknown[] }).data).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('update validates the complete candidate atomically', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Car = Resource.extend({ start: z.number(), end: z.number() }).refine((value) => value.end > value.start)
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', { method: 'POST', headers, body: JSON.stringify({ start: 1, end: 10 }) })

    expect(created.status).toBe(201)
    const car = ((await created.json()) as { data: { id: string } }).data
    const invalid = await app.request(`/cars/${car.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ start: 11 }),
    })

    expect(invalid.status).toBe(422)
    expect(((await (await app.request(`/cars/${car.id}`)).json()) as { data: unknown }).data).toEqual(car)
  } finally {
    app.close()
    backend.close()
  }
})

test('embedded mutations validate the complete owning candidate atomically', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Note = EmbeddedResource.extend({ start: z.number(), end: z.number() }).refine(
    (value) => value.end > value.start,
  )
  const Car = Resource.extend({ make: z.string(), notes: z.array(Note).default([]) })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers,
      body: JSON.stringify({ make: 'Toyota', notes: [{ start: 1, end: 10 }] }),
    })

    expect(created.status).toBe(201)
    const car = ((await created.json()) as { data: { id: string; notes: Array<{ id: string }> } }).data
    const invalid = await app.request(`/cars/${car.id}/notes/${car.notes[0]?.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ start: 11 }),
    })

    expect(invalid.status).toBe(422)
    expect(((await (await app.request(`/cars/${car.id}`)).json()) as { data: unknown }).data).toEqual(car)
  } finally {
    app.close()
    backend.close()
  }
})

test('strict UUID-only models allow server audit metadata without exposing undeclared fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const Car = z.strictObject({ id: z.uuid(), name: z.string() })
  const headers = { 'content-type': 'application/json' }

  try {
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', { method: 'POST', headers, body: JSON.stringify({ name: 'Toyota' }) })

    expect(created.status).toBe(201)
    const car = ((await created.json()) as { data: { id: string; name: string } }).data

    expect(car).toEqual({ id: car.id, name: 'Toyota' })
    expect((await backend.select('cars'))[0]).toMatchObject({
      id: car.id,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const changed = await app.request(`/cars/${car.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Honda' }),
    })

    expect(changed.status).toBe(200)
    expect(((await changed.json()) as { data: unknown }).data).toEqual({ id: car.id, name: 'Honda' })
  } finally {
    app.close()
    backend.close()
  }
})

test('candidate validation cannot alter server-owned resource metadata', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const spoofId = '00000000-0000-4000-8000-000000000000'
  const spoofTime = '2000-01-01T00:00:00.000Z'
  const Car = Resource.extend({ make: z.string() }).overwrite((value) => ({
    ...value,
    id: spoofId,
    createdAt: spoofTime,
    updatedAt: spoofTime,
  }))

  try {
    setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota' }),
    })

    expect(created.status).toBe(422)
    expect(await backend.select('cars')).toEqual([])
  } finally {
    setSystemTime()
    app.close()
    backend.close()
  }
})

test('embedded model transforms cannot change server-owned identity or audit timestamps', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const spoofId = '00000000-0000-4000-8000-000000000000'
  const spoofTime = '2000-01-01T00:00:00.000Z'
  const Note = EmbeddedResource.extend({ text: z.string() }).overwrite((value) => ({
    ...value,
    createdAt: spoofTime,
    updatedAt: spoofTime,
  }))
  const UnsafeNote = EmbeddedResource.extend({ text: z.string() }).overwrite((value) => ({ ...value, id: spoofId }))
  const SafeCar = Resource.extend({ notes: z.array(Note) })
  const UnsafeCar = Resource.extend({ notes: z.array(UnsafeNote) })
  const headers = { 'content-type': 'application/json' }

  try {
    setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    app.register(new Collection('cars', SafeCar))
    app.register(new Collection('unsafe', UnsafeCar))
    const created = await app.request('/cars', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [{ text: 'one' }] }),
    })

    expect(created.status).toBe(422)
    expect(await backend.select('cars')).toEqual([])
    const unsafe = await app.request('/unsafe', {
      method: 'POST',
      headers,
      body: JSON.stringify({ notes: [{ text: 'one' }] }),
    })

    expect(unsafe.status).toBe(422)
    expect(await backend.select('unsafe')).toEqual([])
  } finally {
    setSystemTime()
    app.close()
    backend.close()
  }
})

test('candidate validation rejects transformations that alter managed timestamps', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ env: quiet, backend })
  const spoofTime = '2000-01-01T00:00:00.000Z'
  const Car = Resource.extend({ make: z.string(), createdAt: z.iso.datetime().transform(() => spoofTime) }).refine(
    (value) => value.createdAt === spoofTime,
  )

  try {
    setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    app.register(new Collection('cars', Car))
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota' }),
    })

    expect(created.status).toBe(422)
    expect(await backend.select('cars')).toEqual([])
  } finally {
    setSystemTime()
    app.close()
    backend.close()
  }
})
