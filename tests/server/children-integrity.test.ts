import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Config, Hedra, Resource, SqliteBackend } from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

/** Sends a JSON mutation through the application's real scoped routes. */
async function write(app: Hedra, path: string, value: unknown, method = 'PATCH') {
  return request(app, path, { method, headers, body: JSON.stringify(value) })
}

test('model-generated duplicate child identities roll back root and nested writes', async () => {
  let duplicate = false
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ name: z.string(), children: z.array(Child) })
    .overwrite((value) =>
      duplicate ? { ...value, children: [...value.children, ...value.children.slice(0, 1)] } : value,
    )
    .meta({ name: 'roots' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root)
    const original = Root.parse(
      (await controller.create(context, Root, { name: 'Before', children: [{ value: 'One' }] })).data,
    )

    duplicate = true
    expect((await write(app, `/roots/${original.id}`, { name: 'After' })).status).toBe(422)
    expect((await write(app, `/roots/${original.id}/children`, { value: 'Two' }, 'POST')).status).toBe(422)
    expect((await write(app, '/roots', { name: 'New', children: [{ value: 'One' }] }, 'POST')).status).toBe(422)
    duplicate = false
    expect(Root.parse((await controller.id(context, Root, original.id)).data)).toEqual(original)
    expect((await controller.list(context, Root, context.req.url)).data).toHaveLength(1)
  } finally {
    app.close()
  }
})

test('stored managed metadata fails closed before output can hide it and parent writes retain nothing invalid', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ name: z.string(), children: z.array(Child) }).meta({ name: 'roots' })
  const output = z.object({
    id: z.uuid(),
    name: z.string(),
    children: z.array(z.object({ id: z.uuid(), value: z.string() })),
  })
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const original = Root.parse(
      (await controller.create(context, Root, { name: 'Before', children: [{ value: 'One' }] })).data,
    )
    const path = `/roots/${original.id}`
    const first = original.children[0]

    if (!first) throw new Error('Missing child fixture')

    for (const invalid of [
      { environmentDomain: 'prod.fixture.hedra.local' },
      { createdAt: 'invalid' },
      { updatedAt: 'invalid' },
      { id: 'invalid' },
    ]) {
      const corrupt = { ...original, children: [{ ...first, ...invalid }] }

      await backend.update('roots', original.id, () => corrupt)

      for (const target of ['/roots', path, `${path}/children`, `${path}/children/${first.id}`])
        expect((await request(app, target)).status).toBe(500)
      expect((await write(app, path, { name: 'After' })).status).toBe(500)
      expect((await write(app, `${path}/children`, { value: 'New' }, 'POST')).status).toBe(500)
      expect((await backend.select('roots', { id: original.id }))[0]).toEqual(corrupt)
    }
  } finally {
    app.close()
    backend.close()
  }
})

test('permissive in-place output transforms cannot mutate child or ancestor identity baselines', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({
    children: z.array(Child),
    contact: Resource.extend({ notes: z.array(Child) }).meta({ child: true }),
  }).meta({ name: 'roots' })
  let mode = 'array'
  const output = z.object({ id: z.uuid(), children: z.unknown(), contact: z.unknown() }).overwrite((value) => {
    if (mode === 'array') {
      const items = value.children as Array<{ id: string }>
      const first = items[0]

      if (first) first.id = crypto.randomUUID()
    } else (value.contact as { id: string }).id = crypto.randomUUID()

    return value
  })
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const original = Root.parse(
      (
        await controller.create(context, Root, {
          children: [{ value: 'One' }],
          contact: { notes: [{ value: 'Private' }] },
        })
      ).data,
    )
    const path = `/roots/${original.id}`

    expect((await request(app, `${path}/children`)).status).toBe(500)
    mode = 'ancestor'
    expect((await request(app, `${path}/contact/notes/${original.contact.notes[0]?.id}`)).status).toBe(500)
    expect((await controller.id(context, Root, original.id)).data).toEqual(original)
    expect((await backend.select('roots', { id: original.id }))[0]).toEqual(original)
  } finally {
    app.close()
    backend.close()
  }
})

test('root response identity claims cannot substitute children on create, get, list or update', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ name: z.string(), children: z.array(Child) }).meta({ name: 'roots' })
  const output = Root.overwrite((value) => ({
    ...value,
    children: value.children.map((item) => ({ ...item, id: crypto.randomUUID() })),
  }))
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const original = Root.parse(
      (await controller.create(context, Root, { name: 'Before', children: [{ value: 'One' }] })).data,
    )

    expect((await request(app, `/roots/${original.id}`)).status).toBe(500)
    expect((await request(app, '/roots')).status).toBe(500)

    for (const [path, method, input] of [
      ['/roots', 'POST', { name: 'New', children: [{ value: 'Two' }] }],
      [`/roots/${original.id}`, 'PATCH', { name: 'After' }],
    ] as const) {
      const result = await write(app, path, input, method)

      expect(result.status).toBe(500)
      expect(await result.json()).toMatchObject({
        errors: [{ detail: 'Transaction succeeded, but response validation failed.' }],
      })
    }
    expect((await controller.id(context, Root, original.id)).data.name).toBe('After')
    expect((await controller.list(context, Root, context.req.url)).data).toHaveLength(2)
  } finally {
    app.close()
  }
})

test('dictionary children keep model-valid dotted, email and percent keys through parent and nested CRUD', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ contacts: z.record(z.string().min(1), Child) }).meta({ name: 'roots' })
  const app = new Hedra({ config: new Config(quiet) })

  try {
    app.register(Root)
    const created = await write(app, '/roots', { contacts: { 'home.office': { value: 'Home' } } }, 'POST')

    expect(created.status).toBe(201)
    const root = Root.parse(((await created.json()) as { data: unknown }).data)
    const path = `/roots/${root.id}/contacts`
    const dotted = `${path}/${encodeURIComponent('home.office')}`

    expect((await request(app, dotted)).status).toBe(200)
    expect((await write(app, dotted, { value: 'Edited' })).status).toBe(200)

    for (const key of ['owner@example.test', '100%']) {
      const itemPath = `${path}/${encodeURIComponent(key)}`
      const added = await write(app, itemPath, { value: key }, 'POST')

      expect(added.status).toBe(201)
      expect(added.headers.get('location')?.endsWith(encodeURIComponent(key))).toBe(true)
      expect((await request(app, itemPath)).status).toBe(200)
      expect((await write(app, itemPath, { value: 'Updated' })).status).toBe(200)
    }
    const listed = (await (await request(app, path)).json()) as { data: Record<string, unknown> }

    expect(Object.keys(listed.data)).toEqual(['home.office', 'owner@example.test', '100%'])
    expect((await request(app, dotted, { method: 'DELETE' })).status).toBe(204)

    for (const key of ['', '.', '..', '__proto__', 'constructor', 'prototype', 'a/b', 'a\\b', 'a\u0000b', '\ud800']) {
      expect(
        (await write(app, '/roots', { contacts: Object.fromEntries([[key, { value: 'Unsafe' }]]) }, 'POST')).status,
      ).toBe(422)
    }
    expect((await request(app, `${path}/%E0%A4%A`)).status).toBe(422)
  } finally {
    app.close()
  }
})

test('metadata checks leave private attributes and ordinary object metadata to their existing policies', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({
    password: z.string(),
    profile: z.object({ id: z.string(), environmentDomain: z.string(), child: Child }),
  }).meta({ name: 'roots' })
  const output = z.object({ id: z.uuid(), profile: z.object({ child: z.object({ id: z.uuid(), value: z.string() }) }) })
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const original = Root.parse(
      (
        await controller.create(context, Root, {
          password: 'private',
          profile: { id: 'ordinary', environmentDomain: 'ordinary', child: { value: 'Visible' } },
        })
      ).data,
    )

    await backend.update('roots', original.id, () => ({
      ...original,
      password: 123,
      profile: { ...original.profile, id: false, environmentDomain: null },
    }))
    expect((await request(app, `/roots/${original.id}`)).status).toBe(200)
    expect((await request(app, '/roots')).status).toBe(200)
    expect((await request(app, `/roots/${original.id}/profile/child`)).status).toBe(200)
  } finally {
    app.close()
    backend.close()
  }
})

test('root projection retains native child field omission, filtering, reordering and non-identity transforms', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ children: z.array(Child) }).meta({ name: 'roots' })
  let mode = 'reorder'
  let calls = 0
  const output = z.object({ children: z.unknown() }).overwrite((value) => {
    calls++
    const children = value.children as Array<{ id: string; value: string }>

    if (mode === 'omit') return {} as typeof value
    if (mode === 'transform') return { children: { count: children.length } }
    if (mode === 'no-ids') return { children: children.map((item) => ({ value: item.value })) }

    return { children: [...children].reverse().filter((item) => item.value !== 'Hidden') }
  })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const root = Root.parse(
      (
        await controller.create(context, Root, {
          children: [{ value: 'First' }, { value: 'Hidden' }, { value: 'Last' }],
        })
      ).data,
    )
    const path = `/roots/${root.id}`
    const reordered = await request(app, path)

    expect(reordered.status).toBe(200)
    expect(await reordered.json()).toMatchObject({ data: { children: [{ value: 'Last' }, { value: 'First' }] } })

    for (const value of ['omit', 'transform', 'no-ids']) {
      mode = value
      expect((await request(app, path)).status).toBe(200)
    }
    expect(calls).toBe(4)
  } finally {
    app.close()
  }
})
