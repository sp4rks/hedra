// Choose exactly which account fields appear in REST responses.
// An explicit output schema hides root and nested secrets while keeping complete values in storage.

import { z } from 'zod'

import { Collection, Hedra, JsonApiListResponse, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

// Model the complete stored account, including private root and nested fields.
const Profile = z.object({ displayName: z.string(), password: z.string(), token: z.string() }).loose()
const Account = Resource.extend({ email: z.email(), password: z.string(), token: z.string(), profile: Profile })
const accounts = new Collection('accounts', Account, {
  // Keep public root fields and allow only displayName inside the nested profile.
  outputValidator: Account.omit({ password: true, token: true })
    .extend({ profile: Profile.pick({ displayName: true }).strip() })
    .strip(),
})
// Supply an in-memory backend so the example leaves no database file.
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const headers = { 'content-type': 'application/json' }
// Supply complete write data; the output schema controls which fields appear in responses.
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

// Register the collection with its explicit output policy.
app.register(accounts)

try {
  // Create the account; the response already uses the public shape.
  const response = await app.request('/accounts', { method: 'POST', headers, body: JSON.stringify(input) })
  const created = JsonApiResponse.parse(await response.json())
  const metadata = Resource.parse(created.data)
  // Item and list reads apply the same output schema, including the nested profile selection.
  const found = await app.request(`/accounts/${metadata.id}`)
  const listed = await app.request('/accounts')

  JsonApiResponse.parse(await found.json())
  JsonApiListResponse.parse(await listed.json())

  // Change the email; the PATCH response also uses the public output schema.
  const changed = await app.request(`/accounts/${metadata.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ email: 'ada.updated@example.com' }),
  })

  JsonApiResponse.parse(await changed.json())

  // Read the complete stored model directly; response projection preserves private values in storage.
  Account.parse((await backend.select('accounts', { id: metadata.id }))[0])
} finally {
  // Close the app's controllers, then release its borrowed backend.
  app.close()
  backend.close()
}
