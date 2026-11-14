import { expect, setSystemTime, test } from 'bun:test'
import { z } from 'zod'

import { Collection, Config, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('registration exposes validated resource CRUD routes', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
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

test('generated routes distinguish client errors from failed output validation', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Car = Resource.extend({ make: z.string().trim().min(1), year: z.number() })
  const output = z.object({ id: z.uuid(), make: z.string(), year: z.number() }).refine(() => false)

  try {
    app.register(new Collection('cars', Car), { output })
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
    expect(await outputFailure.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
    expect(await backend.select('cars')).toHaveLength(1)
    expect((await app.request('/cars/not-a-uuid')).status).toBe(422)
    expect((await app.request('/cars?sort=make')).status).toBe(422)
  } finally {
    app.close()
    backend.close()
  }
})

test('unknown literal filter keys cannot silently select every resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })

  try {
    app.register(new Collection('cars', Resource.extend({ make: z.string() })))
    const filter = encodeURIComponent('{"__proto__":"secret"}')

    expect((await app.request(`/cars?filter=${filter}`)).status).toBe(422)
  } finally {
    app.close()
    backend.close()
  }
})

test('create applies model cross-field refinements before writing a resource', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
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
  const app = new Hedra({ config: new Config(quiet), backend })
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

test('strict UUID-only models allow server audit metadata without exposing undeclared fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
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
  const app = new Hedra({ config: new Config(quiet), backend })
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

test('candidate validation rejects transformations that alter managed timestamps', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
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

test('output validation cannot change a resource identity', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Car = Resource.extend({ name: z.string() })
  const output = Car.overwrite((value) => ({ ...value, id: '00000000-0000-4000-8000-000000000000' }))

  try {
    app.register(new Collection('cars', Car), { output })
    const created = await app.request('/cars', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Toyota' }),
    })

    expect(created.status).toBe(500)
    expect(await backend.select('cars')).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})
