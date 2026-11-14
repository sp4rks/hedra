import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { RouteValidators } from '#hedra.ts'
import { InputValidationError } from '#errors'
import { Collection, Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

test('web registration applies independent native Zod input and output schemas', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Account = Resource.extend({
    name: z.string().trim(),
    code: z.string().optional(),
    token: z.string().default('secret'),
  })
  const accounts = new Collection('accounts', Account)

  try {
    app.register(accounts, {
      create: Account.omit({ id: true, createdAt: true, updatedAt: true, environmentDomain: true, token: true })
        .extend({ name: Account.shape.name.transform((name) => name.toUpperCase()) })
        .refine((value) => value.name === 'ALICE'),
      update: Account.pick({ name: true, code: true }).partial().required({ name: true }).strict(),
      output: Account.pick({ id: true, name: true }),
    })
    const invalid = await request(app, '/accounts', { method: 'POST', headers, body: JSON.stringify({ name: 'Bob' }) })

    expect(invalid.status).toBe(422)
    expect(JsonApiListResponse.parse(await (await request(app, '/accounts')).json()).data).toEqual([])
    const created = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: ' Alice ' }),
    })
    const body = JsonApiResponse.parse(await created.json())
    const id = z.uuid().parse(body.data.id)

    expect(created.status).toBe(201)
    expect(body.data).toEqual({ id: expect.any(String), name: 'ALICE' })
    expect(
      (await accounts.controller.id(await scopedContext(`http://localhost/accounts/${id}`), accounts, id)).data.token,
    ).toBe('secret')
    const missingName = await request(app, `/accounts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ code: 'changed' }),
    })

    expect(missingName.status).toBe(422)
    const updated = await request(app, `/accounts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: ' Bob ' }),
    })

    expect(updated.status).toBe(200)
    expect(JsonApiResponse.parse(await updated.json()).data).toEqual({ id, name: 'Bob' })
  } finally {
    app.close()
    backend.close()
  }
})

test('controllers return full resources while the web layer selects public fields', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Account = Resource.extend({ name: z.string(), password: z.string(), token: z.string() })
  const accounts = new Collection('accounts', Account)
  const context = await scopedContext('http://localhost/accounts')

  try {
    app.register(accounts, { output: Account.pick({ id: true, password: true }) })
    const direct = await accounts.controller.create(context, accounts, {
      name: 'Alice',
      password: 'secret',
      token: 'private',
    })

    const id = z.uuid().parse(direct.data.id)

    expect(direct.data).toMatchObject({ name: 'Alice', password: 'secret', token: 'private' })
    const response = await request(app, `/accounts/${id}`)

    expect(response.status).toBe(200)
    expect(JsonApiResponse.parse(await response.json()).data).toEqual({ id, password: 'secret' })
    expect((await accounts.controller.id(context, accounts, id)).data.password).toBe('secret')
    const updated = await accounts.controller.update(context, accounts, { name: 'Bob' }, id)

    expect(updated.data).toMatchObject({ name: 'Bob', password: 'secret', token: 'private' })
    expect((await accounts.controller.list(context, accounts, 'http://localhost/accounts')).data).toEqual([
      updated.data,
    ])
  } finally {
    app.close()
    backend.close()
  }
})

test.each([
  new Error('private callback detail'),
  new InputValidationError('private callback detail', 'private detail'),
])('failed response callbacks report completed writes and redact reads (%s)', async (cause) => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Account = Resource.extend({ name: z.string(), password: z.string() })
  const accounts = new Collection('accounts', Account)
  const context = await scopedContext('http://localhost/accounts')
  const output = Account.pick({ id: true, name: true }).extend({
    name: z.string().transform(() => {
      throw cause
    }),
  })
  const failure = {
    errors: [
      { status: 500, title: 'internal server error', detail: 'Transaction succeeded, but response validation failed.' },
    ],
  }

  try {
    app.register(accounts, { output })
    const created = await request(app, '/accounts', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'Alice', password: 'private password' }),
    })

    expect(created.status).toBe(500)
    expect(await created.json()).toEqual(failure)
    const resources = (await accounts.controller.list(context, accounts, 'http://localhost/accounts')).data
    const id = z.uuid().parse(resources[0]?.id)

    expect(resources).toHaveLength(1)
    expect(resources[0]).toMatchObject({ name: 'Alice', password: 'private password' })
    const updated = await request(app, `/accounts/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ name: 'Bob' }),
    })

    expect(updated.status).toBe(500)
    expect(await updated.json()).toEqual(failure)
    expect((await accounts.controller.id(context, accounts, id)).data.name).toBe('Bob')

    for (const path of ['/accounts', `/accounts/${id}`]) {
      const read = await request(app, path)

      expect(read.status).toBe(500)
      expect(await read.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    }
  } finally {
    app.close()
    backend.close()
  }
})

test('web validator configuration is rejected before registration has side effects', () => {
  const app = new Hedra({ config: new Config(quiet) })
  const Account = Resource.extend({ name: z.string() })
  const accounts = new Collection('accounts', Account)

  try {
    for (const validators of [
      null,
      { create: z.string() },
      { update: {} },
      { output: z.string() },
      { unknown: Account },
    ]) {
      expect(() => app.register(accounts, validators as never)).toThrow('configuration error')
      expect(() => accounts.controller).toThrow('registered')
    }
    app.register(accounts, {
      create: Account.pick({ name: true }),
      update: Account.pick({ name: true }).partial(),
      output: Account,
    })
    expect(accounts.controller).toBeDefined()
  } finally {
    app.close()
  }
})

test('associated collections retain their own registered web constraints', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Model = Resource.extend({ name: z.string(), token: z.string() })
  const target = new Collection('targets', Model)
  const source = new Collection('sources', Model, { associations: [target] })

  try {
    app.register(target, { output: Model.pick({ id: true, name: true }) })
    app.register(source, { output: Model.pick({ id: true, token: true }) })

    for (const [path, expected] of [
      ['/targets', { name: 'Alice' }],
      ['/sources', { token: 'secret' }],
    ] as const) {
      const response = await request(app, path, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Alice', token: 'secret' }),
      })

      expect(response.status).toBe(201)
      expect(JsonApiResponse.parse(await response.json()).data).toEqual({ id: expect.any(String), ...expected })
    }
  } finally {
    app.close()
    backend.close()
  }
})

test.each([
  ['explicit', 'from-web'],
  ['default', 'old'],
] as const)(
  'PATCH retains registered schema semantics when validator options are reused (%s)',
  async (mode, expectedAudit) => {
    const backend = new SqliteBackend(':memory:')
    const app = new Hedra({ config: new Config(quiet), backend })
    const Account = Resource.extend({ name: z.string(), audit: z.string().default('model-default') })
    const accounts = new Collection('accounts', Account)

    try {
      const validators: RouteValidators =
        mode === 'explicit'
          ? { update: Account.pick({ name: true }).extend({ audit: z.string().default('from-web') }) }
          : {}

      app.register(accounts, validators)
      delete validators.update
      app.register(new Collection('other_accounts', Account), validators)
      const created = await request(app, '/accounts', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'Alice', audit: 'old' }),
      })
      const id = z.uuid().parse(JsonApiResponse.parse(await created.json()).data.id)
      const updated = await request(app, `/accounts/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ name: 'Bob' }),
      })

      expect(updated.status).toBe(200)
      expect(JsonApiResponse.parse(await updated.json()).data).toMatchObject({ name: 'Bob', audit: expectedAudit })
      const loaded = await request(app, `/accounts/${id}`)

      expect(JsonApiResponse.parse(await loaded.json()).data).toMatchObject({ name: 'Bob', audit: expectedAudit })
    } finally {
      app.close()
      backend.close()
    }
  },
)
