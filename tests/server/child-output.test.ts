import { expect, test } from 'bun:test'
import { z } from 'zod'

import { Config, Hedra, Resource, SqliteBackend } from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

/** Sends a JSON mutation through generated, provisioned resource routes. */
async function write(app: Hedra, path: string, value: unknown, method = 'PATCH') {
  return request(app, path, { method, headers, body: JSON.stringify(value) })
}

test('fixed child addresses and DTO collection lists permit omitted child IDs', async () => {
  const Child = Resource.extend({ text: z.string() }).meta({ child: true })
  const Root = Resource.extend({
    note: Child.optional(),
    notes: z.record(z.string(), Child),
    items: z.array(Child),
  }).meta({ name: 'roots' })
  const DTO = Child.pick({ text: true })
  let calls = 0
  const output = z
    .object({ id: z.uuid(), note: DTO.optional(), notes: z.record(z.string(), DTO), items: z.array(DTO) })
    .overwrite((value) => {
      calls++

      return value
    })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const created = await write(
      app,
      '/roots',
      { note: { text: 'Note' }, notes: { home: { text: 'Home' } }, items: [{ text: 'Item' }] },
      'POST',
    )

    expect(created.status).toBe(201)
    const root = z.object({ data: z.object({ id: z.uuid() }) }).parse(await created.json())
    const path = `/roots/${root.data.id}`
    const original = Root.parse((await controller.id(context, Root, root.data.id)).data)
    const get = await request(app, `${path}/note`)

    expect(get.status).toBe(200)
    expect(await get.json()).toMatchObject({ data: { text: 'Note' } })
    expect((await write(app, `${path}/note`, { text: 'Changed' })).status).toBe(200)
    expect((await request(app, `${path}/note`, { method: 'DELETE' })).status).toBe(204)
    expect((await write(app, `${path}/note`, { text: 'New' }, 'POST')).status).toBe(201)
    expect((await request(app, `${path}/notes/home`)).status).toBe(200)
    expect((await write(app, `${path}/notes/home`, { text: 'Changed home' })).status).toBe(200)
    const added = await write(app, `${path}/notes/work`, { text: 'Work' }, 'POST')

    expect(added.status).toBe(201)
    expect(added.headers.get('location')?.endsWith('/notes/work')).toBe(true)
    const dictionary = await request(app, `${path}/notes`)

    expect(dictionary.status).toBe(200)
    expect(await dictionary.json()).toMatchObject({ data: { home: { text: 'Changed home' }, work: { text: 'Work' } } })
    expect((await request(app, `${path}/notes/work`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(app, `${path}/notes/work`)).status).toBe(404)
    const list = await request(app, `${path}/items`)

    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({ data: [{ text: 'Item' }] })
    const before = calls

    expect((await request(app, `${path}/items/${original.items[0]?.id}`)).status).toBe(500)
    expect(calls - before).toBe(1)
    expect(Root.parse((await controller.id(context, Root, root.data.id)).data).items).toEqual(original.items)
  } finally {
    app.close()
  }
})

test('anonymous array-parent DTOs retain descendant identity claims on every root response seam', async () => {
  const Leaf = Resource.extend({ text: z.string() }).meta({ child: true })
  const Branch = Resource.extend({ leaves: z.array(Leaf) }).meta({ child: true })
  const Root = Resource.extend({ name: z.string(), branches: z.array(Branch) }).meta({ name: 'roots' })
  let calls = 0
  const output = z
    .object({ id: z.uuid(), name: z.string(), branches: z.array(Branch.pick({ leaves: true })) })
    .overwrite((value) => {
      calls++

      return { ...value, branches: [...value.branches].reverse() }
    })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { output })
    const created = await write(
      app,
      '/roots',
      { name: 'Before', branches: [{ leaves: [{ text: 'First' }] }, { leaves: [{ text: 'Second' }] }] },
      'POST',
    )

    expect(created.status).toBe(201)
    const envelope = z
      .object({ data: z.object({ id: z.uuid(), branches: z.array(z.object({ leaves: z.array(Leaf) })) }) })
      .parse(await created.json())
    const id = envelope.data.id
    const original = Root.parse((await controller.id(context, Root, id)).data)

    expect(envelope.data.branches.map((branch) => branch.leaves[0]?.text)).toEqual(['Second', 'First'])
    expect((await request(app, `/roots/${id}`)).status).toBe(200)
    expect((await request(app, '/roots')).status).toBe(200)
    expect((await write(app, `/roots/${id}`, { name: 'After' })).status).toBe(200)
    expect((await request(app, `/roots/${id}/branches`)).status).toBe(200)
    expect(calls).toBe(5)
    expect(Root.parse((await controller.id(context, Root, id)).data)).toEqual({
      ...original,
      name: 'After',
      updatedAt: expect.any(String),
    })
    const before = calls

    expect((await request(app, `/roots/${id}/branches/${original.branches[0]?.id}/leaves`)).status).toBe(500)
    expect(calls - before).toBe(1)
  } finally {
    app.close()
  }
})

test('anonymous parent matching rejects substituted, duplicated, mixed and ambiguous descendant claims', async () => {
  const Leaf = Resource.extend({ text: z.string() }).meta({ child: true })
  const Branch = Resource.extend({ leaves: z.array(Leaf) }).meta({ child: true })
  const Root = Resource.extend({ branches: z.array(Branch) }).meta({ name: 'roots' })
  let mode = 'valid'
  const output = z.object({ branches: z.array(Branch.pick({ leaves: true })) }).overwrite((value) => {
    if (mode === 'substitute')
      return {
        branches: value.branches.map((branch) => ({
          leaves: branch.leaves.map((leaf) => ({ ...leaf, id: crypto.randomUUID() })),
        })),
      }
    if (mode === 'duplicate') return { branches: [...value.branches, ...value.branches] }
    if (mode === 'mixed') return { branches: [{ leaves: value.branches.flatMap((branch) => branch.leaves) }] }

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
          branches: [{ leaves: [{ text: 'One' }] }, { leaves: [{ text: 'Two' }] }],
        })
      ).data,
    )
    const path = `/roots/${original.id}`

    expect((await request(app, path)).status).toBe(200)

    for (const value of ['substitute', 'duplicate', 'mixed']) {
      mode = value
      expect((await request(app, path)).status).toBe(500)
    }
    expect((await controller.id(context, Root, original.id)).data).toEqual(original)
    mode = 'valid'
    const ambiguous = structuredClone(original)
    const first = ambiguous.branches[0]?.leaves[0]
    const second = ambiguous.branches[1]?.leaves[0]

    if (!first || !second) throw new Error('Missing descendant fixtures')
    second.id = first.id
    await backend.update('roots', original.id, () => ambiguous)
    expect((await request(app, path)).status).toBe(500)
    expect((await backend.select('roots', { id: original.id }))[0]).toEqual(ambiguous)
  } finally {
    app.close()
    backend.close()
  }
})
