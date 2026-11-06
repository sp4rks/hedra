import { expect, setSystemTime, test } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'

import type { ControllerInterface, QueryParams } from '#hedra.ts'
import { BaseController, Collection, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

const Car = Resource.extend({ make: z.string() })

test('BaseController implements the REST contract across collections', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const contract: ControllerInterface = controller
  const cars = new Collection('cars', Car)
  const labels = new Collection('labels', Resource.extend({ label: z.string() }))
  const app = new Hono()
  // @ts-expect-error BaseController is independent of resource model types.
  const invalid = new BaseController<z.output<typeof Car>>(backend)

  app.post('/cars', async (context) => context.json(await contract.create(context, cars, { make: 'Toyota' })))
  app.post('/labels', async (context) => context.json(await contract.create(context, labels, { label: 'Important' })))

  try {
    expect(invalid).toBeInstanceOf(BaseController)
    const car = JsonApiResponse.parse(await (await app.request('http://localhost/cars', { method: 'POST' })).json())
    const label = JsonApiResponse.parse(await (await app.request('http://localhost/labels', { method: 'POST' })).json())

    expect(car.data.make).toBe('Toyota')
    expect(label.data.label).toBe('Important')
    expect(await backend.select('cars')).toHaveLength(1)
    expect(await backend.select('labels')).toHaveLength(1)
  } finally {
    backend.close()
  }
})

test('create replaces client metadata and preserves ordinary attributes', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const cars = new Collection('cars', Car)
  const app = new Hono()

  app.post('/cars/', async (context) => context.json(await controller.create(context, cars, await context.req.json())))

  try {
    const response = await app.request('http://localhost/cars/?draft=true', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ make: 'Toyota', id: 'spoof', createdAt: 'old', updatedAt: 'old' }),
    })
    const body = JsonApiResponse.parse(await response.json())
    const resource = Resource.parse(body.data)

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ ...resource, make: 'Toyota' })
    expect(resource.createdAt).toBe(resource.updatedAt)
    expect(body.links.self).toBe(`http://localhost/cars/${resource.id}`)
    expect(await backend.select('cars')).toEqual([{ ...resource, make: 'Toyota' }])
  } finally {
    backend.close()
  }
})

test('id returns the addressed resource and reports absent resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const cars = new Collection('cars', Car)
  const app = new Hono()
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  app.get('/cars/:id', async (context) => context.json(await controller.id(context, cars, context.req.param('id'))))
  app.onError((error, context) => context.json({ status: (error as { status?: number }).status }, 404))

  try {
    const car = { id, make: 'Toyota', createdAt: timestamp, updatedAt: timestamp }

    await backend.insert('cars', car)
    const response = await app.request(`http://localhost/cars/${id}`)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: car, links: { self: `http://localhost/cars/${id}` } })
    const missing = await app.request(`http://localhost/cars/${crypto.randomUUID()}`)

    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ status: 404 })
  } finally {
    backend.close()
  }
})

test('update preserves identity and creation time while refreshing update time', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Model = Car.extend({ note: z.string().optional() })
  const cars = new Collection('cars', Model)
  const app = new Hono()
  const id = crypto.randomUUID()
  const before = '2026-01-02T03:04:05.000Z'
  const after = '2026-02-03T04:05:06.000Z'

  app.patch('/cars/:id', async (context) =>
    context.json(await controller.update(context, cars, await context.req.json(), context.req.param('id'))),
  )

  try {
    await backend.insert('cars', { id, make: 'Toyota', note: 'keep', createdAt: before, updatedAt: before })
    setSystemTime(new Date(after))
    const response = await app.request(`http://localhost/cars/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), createdAt: 'spoof', updatedAt: 'spoof', make: 'Honda' }),
    })
    const expected = { id, make: 'Honda', note: 'keep', createdAt: before, updatedAt: after }

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: expected, links: { self: `http://localhost/cars/${id}` } })
    expect(await backend.select('cars')).toEqual([expected])
  } finally {
    setSystemTime()
    backend.close()
  }
})

test('list retains equality filters and correct response links', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Model = Resource.extend({ make: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) })
  const cars = new Collection('cars', Model)
  const app = new Hono()
  const timestamp = '2026-01-02T03:04:05.000Z'
  let params: QueryParams | undefined

  app.get('/cars', async (context) =>
    context.json(await controller.list(context, cars, 'http://localhost/cars?view=all', params)),
  )
  app.onError((error, context) => context.text(error.message, 400))

  try {
    const first = { id: crypto.randomUUID(), make: 'Toyota', value: 1, createdAt: timestamp, updatedAt: timestamp }
    const second = { id: crypto.randomUUID(), make: 'Honda', value: '1', createdAt: timestamp, updatedAt: timestamp }
    const third = { id: crypto.randomUUID(), make: 'Toyota', value: null, createdAt: timestamp, updatedAt: timestamp }
    const special = { id: crypto.randomUUID(), make: 'Special', value: 2, createdAt: timestamp, updatedAt: timestamp }
    const literal = { ...special, ...JSON.parse('{"__proto__":"literal"}') }

    await backend.insert('cars', first)
    await backend.insert('cars', second)
    await backend.insert('cars', third)
    await backend.insert('cars', literal)
    params = { filter: { make: 'Toyota' } }
    let response = await app.request('http://localhost/cars')

    expect(await response.json()).toEqual({ data: [first, third], links: { self: 'http://localhost/cars?view=all' } })
    params = { filter: { value: '1' } }
    response = await app.request('http://localhost/cars')
    expect(JsonApiListResponse.parse(await response.json()).data).toEqual([second])
    params = { filter: { value: null } }
    response = await app.request('http://localhost/cars')
    expect(JsonApiListResponse.parse(await response.json()).data).toEqual([third])
    params = { filter: JSON.parse('{"__proto__":"literal"}') }
    response = await app.request('http://localhost/cars')
    expect(JsonApiListResponse.parse(await response.json()).data).toEqual([special])
    params = { sort: 'make' } as never
    expect((await app.request('http://localhost/cars')).status).toBe(400)
    params = { filter: { make: { nested: true } } } as never
    expect((await app.request('http://localhost/cars')).status).toBe(400)
    params = { filter: JSON.parse('{"__proto__":{"nested":true}}') }
    expect((await app.request('http://localhost/cars')).status).toBe(400)
  } finally {
    backend.close()
  }
})

test('REST lookup and mutation use expected absence behaviour', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const cars = new Collection('cars', Car)
  const app = new Hono()
  const timestamp = '2026-01-02T03:04:05.000Z'
  const first = { id: crypto.randomUUID(), make: 'Toyota', createdAt: timestamp, updatedAt: timestamp }
  const second = { id: crypto.randomUUID(), make: 'Honda', createdAt: timestamp, updatedAt: timestamp }

  app.get('/cars/:id', async (context) => context.json(await controller.id(context, cars, context.req.param('id'))))
  app.patch('/cars/:id', async (context) =>
    context.json(await controller.update(context, cars, {}, context.req.param('id'))),
  )
  app.delete('/cars/:id', async (context) => {
    await controller.delete(context, cars, context.req.param('id'))

    return context.body(null, 204)
  })
  app.onError((error, context) => context.json({ status: (error as { status?: number }).status }, 404))

  try {
    await backend.insert('cars', first)
    await backend.insert('cars', second)
    const missing = crypto.randomUUID()

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const response = await app.request(`http://localhost/cars/${missing}`, { method })

      expect(response.status).toBe(404)
      expect(await response.json()).toEqual({ status: 404 })
    }
    expect((await app.request(`http://localhost/cars/${first.id}`, { method: 'DELETE' })).status).toBe(204)
    expect(await backend.select('cars')).toEqual([second])
  } finally {
    backend.close()
  }
})

test('all resource responses project public output without changing stored data', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Account = Resource.extend({ username: z.string(), password: z.string(), token: z.string() })
    .loose()
    .refine((value) => value.password.length > 0)
  const accounts = new Collection('accounts', Account)
  const restricted = new Collection('restricted', Account, {
    outputValidator: z.looseObject({ id: z.uuid(), username: z.string() }),
  })
  const explicit = new Collection('explicit', Account, {
    outputValidator: z.looseObject({ id: z.uuid(), password: z.string() }),
  })
  const app = new Hono()

  app.post('/accounts', async (context) =>
    context.json(await controller.create(context, accounts, await context.req.json())),
  )
  app.get('/accounts', async (context) =>
    context.json(await controller.list(context, accounts, 'http://localhost/accounts')),
  )
  app.get('/accounts/:id', async (context) =>
    context.json(await controller.id(context, accounts, context.req.param('id'))),
  )
  app.patch('/accounts/:id', async (context) =>
    context.json(await controller.update(context, accounts, await context.req.json(), context.req.param('id'))),
  )
  app.post('/restricted', async (context) =>
    context.json(await controller.create(context, restricted, await context.req.json())),
  )
  app.post('/explicit', async (context) =>
    context.json(await controller.create(context, explicit, await context.req.json())),
  )

  try {
    const input = { username: 'alice', password: 'secret', token: 'token', extra: 'private' }
    const created = JsonApiResponse.parse(
      await (
        await app.request('http://localhost/accounts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    )
    const metadata = Resource.parse(created.data)
    const id = metadata.id
    const expected = { ...metadata, username: 'alice', token: 'token' }

    expect(created.data).toEqual(expected)
    expect(JsonApiResponse.parse(await (await app.request(`http://localhost/accounts/${id}`)).json()).data).toEqual(
      expected,
    )
    const updated = JsonApiResponse.parse(
      await (
        await app.request(`http://localhost/accounts/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'bob' }),
        })
      ).json(),
    )
    const updatedExpected = { ...expected, username: 'bob', updatedAt: z.iso.datetime().parse(updated.data.updatedAt) }

    expect(updated.data).toEqual(updatedExpected)
    expect(JsonApiListResponse.parse(await (await app.request('http://localhost/accounts')).json()).data).toEqual([
      updatedExpected,
    ])
    expect(await backend.select('accounts')).toEqual([{ ...updatedExpected, password: 'secret', extra: 'private' }])
    const hidden = JsonApiResponse.parse(
      await (
        await app.request('http://localhost/restricted', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    )
    const hiddenId = z.uuid().parse(hidden.data.id)

    expect(hidden.data).toEqual({ id: hiddenId, username: 'alice' })
    expect(await backend.select('restricted')).toEqual([
      { id: hiddenId, ...input, createdAt: expect.any(String), updatedAt: expect.any(String) },
    ])
    const selected = JsonApiResponse.parse(
      await (
        await app.request('http://localhost/explicit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    )

    expect(selected.data).toEqual({ id: z.uuid().parse(selected.data.id), password: 'secret' })
  } finally {
    backend.close()
  }
})

test('update projects output once inside its atomic mutation', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Model = Resource.extend({ name: z.string() })
  let validations = 0
  const outputValidator = z.object({ id: z.uuid(), name: z.string() }).refine(() => ++validations === 1)
  const users = new Collection('users', Model, { outputValidator })
  const app = new Hono()
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  app.patch('/users/:id', async (context) =>
    context.json(await controller.update(context, users, { name: 'Bob' }, context.req.param('id'))),
  )

  try {
    await backend.insert('users', { id, name: 'Alice', createdAt: timestamp, updatedAt: timestamp })
    const response = await app.request(`http://localhost/users/${id}`, { method: 'PATCH' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id, name: 'Bob' },
      links: { self: `http://localhost/users/${id}` },
    })
  } finally {
    backend.close()
  }
})

test('output validator failures never return unfiltered resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Model = Resource.extend({ name: z.string(), password: z.string() })
  const outputValidator = z.object({ id: z.uuid(), name: z.string().refine(() => false) })
  const users = new Collection('users', Model, { outputValidator })
  const app = new Hono()
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  app.get('/users', async (context) => context.json(await controller.list(context, users, 'http://localhost/users')))
  app.get('/users/:id', async (context) => context.json(await controller.id(context, users, context.req.param('id'))))
  app.post('/users', async (context) => context.json(await controller.create(context, users, await context.req.json())))
  app.patch('/users/:id', async (context) =>
    context.json(await controller.update(context, users, { name: 'Bob' }, context.req.param('id'))),
  )
  app.onError((_error, context) => context.text('output rejected', 500))

  try {
    await backend.insert('users', {
      id,
      name: 'Alice',
      password: 'private',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    for (const [path, init] of [
      ['http://localhost/users', undefined],
      [`http://localhost/users/${id}`, undefined],
      [
        'http://localhost/users',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alice', password: 'private' }),
        },
      ],
    ] as const) {
      const response = await app.request(path, init)

      expect(response.status).toBe(500)
      expect(await response.text()).toBe('output rejected')
    }

    const update = await app.request(`http://localhost/users/${id}`, { method: 'PATCH' })

    expect(update.status).toBe(500)
    expect(await update.text()).toBe('output rejected')
    expect(await backend.select('users')).toEqual([
      { id, name: 'Alice', password: 'private', createdAt: timestamp, updatedAt: timestamp },
    ])
  } finally {
    backend.close()
  }
})
