import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'
import { fixtureDomain, request } from '../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

test('loose web output schemas retain extra fields on every resource response', async () => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ name: z.string(), password: z.string() }).loose()
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(Account.meta({ name: 'accounts' }), { output: z.looseObject({ id: z.uuid(), name: z.string() }) })

  try {
    const createdResponse = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', password: 'secret', extra: 'retained' }),
    })
    const created = JsonApiResponse.parse(await createdResponse.json()).data
    const id = z.uuid().parse(created.id)
    const expected = {
      id,
      environmentDomain: fixtureDomain,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      name: 'Alice',
      password: 'secret',
      extra: 'retained',
    }

    expect(createdResponse.status).toBe(201)
    expect(created).toEqual(expected)
    expect(JsonApiResponse.parse(await (await request(app, `/accounts/${id}`)).json()).data).toEqual(expected)
    const updatedResponse = await request(app, `/accounts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Bob' }),
    })
    const updated = JsonApiResponse.parse(await updatedResponse.json()).data
    const updatedExpected = { ...expected, name: 'Bob', updatedAt: z.iso.datetime().parse(updated.updatedAt) }

    expect(updatedResponse.status).toBe(200)
    expect(updated).toEqual(updatedExpected)
    expect(JsonApiListResponse.parse(await (await request(app, '/accounts')).json()).data).toEqual([updatedExpected])
  } finally {
    app.close()
    backend.close()
  }
})

test('strict web output schemas reject extra fields without exposing controller data', async () => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ name: z.string(), password: z.string() })
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(Account.meta({ name: 'accounts' }), { output: z.strictObject({ id: z.uuid(), name: z.string() }) })

  try {
    const created = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', password: 'secret' }),
    })

    expect(created.status).toBe(500)
    expect(await created.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
    const stored = await backend.select('accounts')
    const id = z.uuid().parse(stored[0]?.id)

    for (const path of ['/accounts', `/accounts/${id}`]) {
      const response = await request(app, path)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    }
  } finally {
    app.close()
    backend.close()
  }
})

test('web output catchalls retain valid extra fields and reject invalid ones', async () => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ name: z.string() }).loose()
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(Account.meta({ name: 'accounts' }), {
    output: z.object({ id: z.uuid(), name: z.string() }).catchall(z.string()),
  })

  try {
    const created = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', extra: 'retained' }),
    })
    const data = JsonApiResponse.parse(await created.json()).data
    const id = z.uuid().parse(data.id)

    expect(created.status).toBe(201)
    expect(data).toEqual({
      id,
      name: 'Alice',
      extra: 'retained',
      environmentDomain: fixtureDomain,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    })
    const invalid = await request(app, `/accounts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ extra: 42 }),
    })

    expect(invalid.status).toBe(500)
    expect(await invalid.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
  } finally {
    app.close()
    backend.close()
  }
})

test.each([
  ['undefined', undefined],
  ['a non-finite number', Number.NaN],
  ['a bigint', 1n],
  ['a Date', new Date('2026-01-02T03:04:05.000Z')],
])('web output rejects %s produced by a transform', async (_name, value) => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ name: z.string() })
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(Account.meta({ name: 'accounts' }), {
    output: Account.pick({ name: true }).extend({ name: z.string().transform(() => value) }),
  })

  try {
    const response = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
  } finally {
    app.close()
    backend.close()
  }
})

test.each([
  ['null', null],
  ['an array', []],
  ['a string', 'invalid'],
])('web output rejects a malformed overwrite returning %s', async (_name, value) => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ name: z.string() })
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(Account.meta({ name: 'accounts' }), {
    output: Account.pick({ name: true }).overwrite(() => value as never),
  })

  try {
    const response = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice' }),
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
  } finally {
    app.close()
    backend.close()
  }
})
