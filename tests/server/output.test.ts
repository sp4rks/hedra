import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'
import { fixtureDomain, insert, request } from '../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('default and ordinary web output schemas strip private fields without changing stored data', async () => {
  const backend = new SqliteBackend(':memory:')
  const Account = Resource.extend({ username: z.string(), password: z.string(), token: z.string() })
    .loose()
    .refine((value) => value.password.length > 0)
  const accounts = Account.meta({ name: 'accounts' })
  const restricted = Account.meta({ name: 'restricted' })
  const explicit = Account.meta({ name: 'explicit' })
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(accounts)
  app.register(restricted, { output: z.object({ id: z.uuid(), username: z.string() }) })
  app.register(explicit, { output: z.object({ id: z.uuid(), password: z.string() }) })

  try {
    const input = { username: 'alice', password: 'secret', token: 'token', extra: 'private' }
    const created = JsonApiResponse.parse(
      await (
        await request(app, 'http://localhost/accounts', {
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
    expect(JsonApiResponse.parse(await (await request(app, `http://localhost/accounts/${id}`)).json()).data).toEqual(
      expected,
    )
    const updated = JsonApiResponse.parse(
      await (
        await request(app, `http://localhost/accounts/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'bob' }),
        })
      ).json(),
    )
    const updatedExpected = { ...expected, username: 'bob', updatedAt: z.iso.datetime().parse(updated.data.updatedAt) }

    expect(updated.data).toEqual(updatedExpected)
    expect(JsonApiListResponse.parse(await (await request(app, 'http://localhost/accounts')).json()).data).toEqual([
      updatedExpected,
    ])
    expect(await backend.select('accounts')).toEqual([{ ...updatedExpected, password: 'secret', extra: 'private' }])
    const hidden = JsonApiResponse.parse(
      await (
        await request(app, 'http://localhost/restricted', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    )
    const hiddenId = z.uuid().parse(hidden.data.id)

    expect(hidden.data).toEqual({ id: hiddenId, username: 'alice' })
    expect(await backend.select('restricted')).toEqual([
      {
        id: hiddenId,
        ...input,
        environmentDomain: fixtureDomain,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ])
    const selected = JsonApiResponse.parse(
      await (
        await request(app, 'http://localhost/explicit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
      ).json(),
    )

    expect(selected.data).toEqual({ id: z.uuid().parse(selected.data.id), password: 'secret' })
  } finally {
    app.close()
    backend.close()
  }
})

test('web validates update output once after its atomic mutation', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({ name: z.string() })
  let validations = 0
  const outputValidator = z.object({ id: z.uuid(), name: z.string() }).refine(() => ++validations === 1)
  const users = Model.meta({ name: 'users' })
  const app = new Hedra({ config: new Config(quiet), backend })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  app.register(users, { output: outputValidator })

  try {
    await insert(backend, 'users', { id, name: 'Alice', createdAt: timestamp, updatedAt: timestamp })
    const response = await request(app, `http://localhost/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { id, name: 'Bob' },
      links: { self: `http://localhost/users/${id}` },
    })
  } finally {
    app.close()
    backend.close()
  }
})

test('output validator failures never return unfiltered resources', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({ name: z.string(), password: z.string() })
  const outputValidator = z.object({ id: z.uuid(), name: z.string().refine(() => false) })
  const users = Model.meta({ name: 'users' })
  const app = new Hedra({ config: new Config(quiet), backend })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'

  app.register(users, { output: outputValidator })

  try {
    await insert(backend, 'users', {
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
      const response = await request(app, path, init)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({
        errors: [
          {
            status: 500,
            title: 'internal server error',
            ...(init ? { detail: 'Transaction succeeded, but response validation failed.' } : {}),
          },
        ],
      })
    }

    const update = await request(app, `http://localhost/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })

    expect(update.status).toBe(500)
    expect(await update.json()).toEqual({
      errors: [
        {
          status: 500,
          title: 'internal server error',
          detail: 'Transaction succeeded, but response validation failed.',
        },
      ],
    })
    expect((await backend.select('users')).find((resource) => resource.id === id)).toMatchObject({
      id,
      name: 'Bob',
      password: 'private',
      createdAt: timestamp,
    })
    expect(await backend.select('users')).toHaveLength(2)
  } finally {
    app.close()
    backend.close()
  }
})

test('output transforms cannot mutate nested attributes persisted by create or update', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({ profile: z.unknown() })
  const outputValidator = z.object({
    id: z.uuid(),
    profile: z.unknown().transform((value) => {
      const profile = value as { visible: string; secret?: string }

      delete profile.secret

      return profile
    }),
  })
  const users = Model.meta({ name: 'users' })
  const app = new Hedra({ config: new Config(quiet), backend })

  app.register(users, { output: outputValidator })

  try {
    const initial = { visible: 'Alice', secret: 'create secret' }
    const response = await request(app, 'http://localhost/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: initial }),
    })
    const created = JsonApiResponse.parse(await response.json())
    const id = z.uuid().parse(created.data.id)

    expect(created.data.profile).toEqual({ visible: 'Alice' })
    expect((await backend.select('users', { id }))[0]?.profile).toEqual(initial)
    const changed = { visible: 'Bob', secret: 'update secret' }
    const update = await request(app, `http://localhost/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: changed }),
    })
    const updated = JsonApiResponse.parse(await update.json())

    expect(updated.data.profile).toEqual({ visible: 'Bob' })
    expect((await backend.select('users', { id }))[0]?.profile).toEqual(changed)
  } finally {
    app.close()
    backend.close()
  }
})

test('output transforms cannot mutate an existing nested attribute during update', async () => {
  const backend = new SqliteBackend(':memory:')
  const Model = Resource.extend({ profile: z.unknown(), name: z.string() })
  const outputValidator = z.object({
    id: z.uuid(),
    profile: z.unknown().transform((value) => {
      const profile = value as { visible: string; secret?: string }

      delete profile.secret

      return profile
    }),
  })
  const users = Model.meta({ name: 'users' })
  const app = new Hedra({ config: new Config(quiet), backend })
  const id = crypto.randomUUID()
  const timestamp = '2026-01-02T03:04:05.000Z'
  const profile = { visible: 'Alice', secret: 'private' }

  app.register(users, { output: outputValidator })

  try {
    await insert(backend, 'users', { id, name: 'Alice', profile, createdAt: timestamp, updatedAt: timestamp })
    const response = await request(app, `http://localhost/users/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Bob' }),
    })
    const updated = JsonApiResponse.parse(await response.json())

    expect(updated.data.profile).toEqual({ visible: 'Alice' })
    expect((await backend.select('users', { id }))[0]?.profile).toEqual(profile)
  } finally {
    app.close()
    backend.close()
  }
})
