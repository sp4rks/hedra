import assert from 'node:assert/strict'
import { z } from 'zod'

import { Collection, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

const Profile = z.object({ displayName: z.string(), password: z.string(), token: z.string() }).loose()
const Account = Resource.extend({ email: z.email(), password: z.string(), token: z.string(), profile: Profile })
const accounts = new Collection('accounts', Account, {
  // BaseController applies this explicit public shape to every resource response.
  outputValidator: Account.omit({ password: true, token: true })
    .extend({ profile: Profile.pick({ displayName: true }).strip() })
    .strip(),
})
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const headers = { 'content-type': 'application/json' }
const input = {
  email: 'ada@example.com',
  password: 'example-password',
  token: 'example-token',
  profile: {
    displayName: 'Ada',
    password: 'nested-example-password',
    token: 'nested-example-token',
    internalNote: 'Stored, but omitted by the explicit nested output schema.',
  },
}

app.register(accounts)

try {
  const response = await app.request('/accounts', { method: 'POST', headers, body: JSON.stringify(input) })
  const created = JsonApiResponse.parse(await response.json())
  const metadata = Resource.parse(created.data)
  const expected = { ...metadata, email: 'ada@example.com', profile: { displayName: 'Ada' } }

  assert.equal(response.status, 201)
  assert.deepEqual(created.data, expected)
  const found = await app.request(`/accounts/${metadata.id}`)
  const listed = await app.request('/accounts')

  assert.equal(found.status, 200)
  assert.deepEqual(JsonApiResponse.parse(await found.json()).data, expected)
  assert.equal(listed.status, 200)
  assert.deepEqual(JsonApiListResponse.parse(await listed.json()).data, [expected])
  const changed = await app.request(`/accounts/${metadata.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ email: 'ada.updated@example.com' }),
  })
  const updated = JsonApiResponse.parse(await changed.json())

  assert.equal(changed.status, 200)
  assert.equal(updated.data.id, metadata.id)
  assert.deepEqual(updated.data, {
    ...Resource.parse(updated.data),
    email: 'ada.updated@example.com',
    profile: { displayName: 'Ada' },
  })
  // Response projection leaves the private values in storage for application use.
  const stored = Account.parse((await backend.select('accounts', { id: metadata.id }))[0])

  assert.equal(stored.password, input.password)
  assert.equal(stored.token, input.token)
  assert.deepEqual(stored.profile, input.profile)
} finally {
  app.close()
  backend.close()
}
