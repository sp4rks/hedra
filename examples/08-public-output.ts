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
  // Every response uses the explicit public shape, including nested profile fields.
  const found = await app.request(`/accounts/${metadata.id}`)
  const listed = await app.request('/accounts')

  JsonApiResponse.parse(await found.json())
  JsonApiListResponse.parse(await listed.json())

  const changed = await app.request(`/accounts/${metadata.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ email: 'ada.updated@example.com' }),
  })

  JsonApiResponse.parse(await changed.json())

  // Response projection leaves the private values in storage for application use.
  Account.parse((await backend.select('accounts', { id: metadata.id }))[0])
} finally {
  app.close()
  backend.close()
}
