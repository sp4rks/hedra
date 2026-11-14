import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { ControllerInterface } from '#hedra.ts'
import { Collection, Config, Hedra, JsonApiListResponse, JsonApiResponse, Resource } from '#hedra.ts'
import { request } from '../fixtures/scope.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const id = '65779c82-9ae6-4146-8a82-14a9aad6728d'
const timestamp = '2026-01-01T00:00:00.000Z'
const resource = {
  id,
  createdAt: timestamp,
  updatedAt: timestamp,
  name: 'Alice',
  password: 'private',
  token: 'secret',
  extra: 'unknown',
  profile: { displayName: 'Alice', secret: 'private' },
}
const links = { self: `http://localhost/accounts/${id}` }

test('generated routes preserve web schema output and isolate custom controller resources', async () => {
  class CustomController implements ControllerInterface {
    /** Returns the complete created resource. */
    async create() {
      return { data: resource, links }
    }
    /** Returns the complete addressed resource. */
    async id() {
      return { data: resource, links }
    }
    /** Returns complete resources. */
    async list() {
      return { data: [resource], links: { self: 'http://localhost/accounts' } }
    }
    /** Returns the complete updated resource. */
    async update() {
      return { data: resource, links }
    }
    /** Deletes the resource. */
    async delete() {}
  }
  const app = new Hedra({ config: new Config(quiet) })
  const Account = Resource.extend({ name: z.string(), password: z.string(), token: z.string() })
  const accounts = new Collection('accounts', Account, { controller: CustomController })

  try {
    app.register(accounts, {
      output: Account.pick({ id: true, name: true })
        .extend({
          profile: z.unknown().transform((value) => {
            const profile = value as { displayName: string; secret?: string }

            delete profile.secret

            return profile
          }),
        })
        .overwrite((value) => ({ ...value, label: 'Public account' })),
    })

    for (const [path, init] of [
      [
        '/accounts',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'Alice', password: 'private', token: 'secret' }),
        },
      ],
      [`/accounts/${id}`, undefined],
      [`/accounts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' }],
    ] as const) {
      const response = await request(app, path, init)

      expect(response.status).toBe(init?.method === 'POST' ? 201 : 200)
      expect(JsonApiResponse.parse(await response.json()).data).toEqual({
        id,
        name: 'Alice',
        profile: { displayName: 'Alice' },
        label: 'Public account',
      })
    }
    const listed = await request(app, '/accounts')

    expect(listed.status).toBe(200)
    expect(JsonApiListResponse.parse(await listed.json()).data).toEqual([
      { id, name: 'Alice', profile: { displayName: 'Alice' }, label: 'Public account' },
    ])
    expect(resource.password).toBe('private')
    expect(resource.profile).toEqual({ displayName: 'Alice', secret: 'private' })
  } finally {
    app.close()
  }
})

test('malformed custom output never bypasses web validation or exposes private data', async () => {
  let result: unknown

  class CustomController implements ControllerInterface {
    /** Returns the injected create result. */
    async create(): Promise<JsonApiResponse> {
      return result as JsonApiResponse
    }
    /** Returns the injected read result. */
    async id(): Promise<JsonApiResponse> {
      return result as JsonApiResponse
    }
    /** Returns the injected list result. */
    async list(): Promise<JsonApiListResponse> {
      return result as JsonApiListResponse
    }
    /** Returns the injected update result. */
    async update(): Promise<JsonApiResponse> {
      return result as JsonApiResponse
    }
    /** Deletes the resource. */
    async delete() {}
  }
  const app = new Hedra({ config: new Config(quiet) })
  const Account = Resource.extend({ name: z.string() })

  try {
    app.register(new Collection('accounts', Account, { controller: CustomController }), {
      output: Account.pick({ name: true }),
    })

    for (const invalid of [
      null,
      { data: resource, links: { self: 'private invalid link' } },
      { data: { ...resource, name: 123 }, links },
      { data: { ...resource, id: '11bc6c96-51ce-4526-bb5c-962252f75087' }, links },
      { data: { ...resource, hidden: undefined }, links },
    ]) {
      result = invalid
      const response = await request(app, `/accounts/${id}`)

      expect(response.status).toBe(500)
      expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    }
    result = { data: resource, links }
    const invalidList = await request(app, '/accounts')

    expect(invalidList.status).toBe(500)
    expect(await invalidList.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    result = { data: [{ ...resource, name: 123 }], links }
    expect((await request(app, '/accounts')).status).toBe(500)
    result = { data: resource, links: {} }
    const invalidCreate = await request(app, '/accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })

    expect(invalidCreate.status).toBe(500)
    expect(await invalidCreate.json()).toEqual({
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
  }
})
