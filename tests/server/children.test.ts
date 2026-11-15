import { expect, test } from 'bun:test'
import { z } from 'zod'

import { BaseController, Config, getResourceScope, Hedra, Resource } from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

/** Sends a JSON mutation through the provisioned application's public routes. */
async function write(app: Hedra, path: string, method: string, value: unknown) {
  return request(app, path, { method, headers, body: JSON.stringify(value) })
}

test('a child schema is reusable under roots and fields without standalone storage', async () => {
  const Address = Resource.extend({ street: z.string() }).meta({ child: true, name: 'ignored' })
  const Customer = Resource.extend({ home: z.array(Address), work: z.array(Address) }).meta({ name: 'customers' })
  const Supplier = Resource.extend({ addresses: z.array(Address) }).meta({ name: 'suppliers' })
  const app = new Hedra({ config: new Config(quiet) })

  try {
    app.register(Customer)
    app.register(Supplier)
    const created = await write(app, '/customers', 'POST', { home: [{ street: 'Home' }], work: [] })

    expect(created.status).toBe(201)
    const root = (await created.json()) as {
      data: { id: string; home: Array<{ id: string; environmentDomain: string }> }
    }
    const path = `/customers/${root.data.id}`
    const child = await write(app, `${path}/work`, 'POST', { street: 'Office' })

    expect(child.status).toBe(201)
    const added = (await child.json()) as { data: { id: string; street: string } }

    expect(added.data.street).toBe('Office')
    expect(added.data.id).not.toBe(root.data.home[0]?.id)
    expect((await request(app, `${path}/work/${added.data.id}`)).status).toBe(200)
    expect((await request(app, `${path}/home/${added.data.id}`)).status).toBe(404)
    expect((await request(app, '/ignored')).status).toBe(404)
    expect((await write(app, '/suppliers', 'POST', { addresses: [{ street: 'Supplier' }] })).status).toBe(201)
    expect((await request(app, `${path}/work`)).status).toBe(200)
    expect((await request(app, `${path}/work/${added.data.id}`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(app, `${path}/work/${added.data.id}`)).status).toBe(404)
  } finally {
    app.close()
  }
})

test('singletons and dictionaries keep their addresses through deeper child CRUD', async () => {
  const Note = Resource.extend({ text: z.string() }).meta({ child: true })
  const Contact = Resource.extend({ name: z.string(), notes: z.array(Note) }).meta({ child: true })
  const Account = Resource.extend({
    contact: Contact.nullable().optional(),
    contacts: z.record(z.string().regex(/^[a-z]+$/), Contact).default({}),
  }).meta({ name: 'accounts' })
  const app = new Hedra({ config: new Config(quiet) })

  try {
    app.register(Account)
    const created = await write(app, '/accounts', 'POST', {})
    const root = (await created.json()) as { data: { id: string } }
    const path = `/accounts/${root.data.id}`

    expect(created.status).toBe(201)
    expect((await request(app, `${path}/contact`)).status).toBe(404)
    expect((await write(app, `${path}/contact`, 'POST', { name: 'Primary', notes: [] })).status).toBe(201)
    expect((await write(app, `${path}/contact`, 'POST', { name: 'Duplicate', notes: [] })).status).toBe(409)
    const note = await write(app, `${path}/contact/notes`, 'POST', { text: 'Hello' })
    const item = (await note.json()) as { data: { id: string } }

    expect(note.status).toBe(201)
    expect((await write(app, `${path}/contact/notes/${item.data.id}`, 'PATCH', { text: 'Edited' })).status).toBe(200)
    expect((await write(app, `${path}/contacts/billing`, 'POST', { name: 'Billing', notes: [] })).status).toBe(201)
    expect((await write(app, `${path}/contacts/billing`, 'POST', { name: 'Duplicate', notes: [] })).status).toBe(409)
    const dictionary = (await (await request(app, `${path}/contacts`)).json()) as {
      data: Record<string, { name: string }>
    }

    expect(Object.keys(dictionary.data)).toEqual(['billing'])
    expect(dictionary.data.billing?.name).toBe('Billing')
    expect((await write(app, `${path}/contacts/billing`, 'PATCH', { name: 'Accounts' })).status).toBe(200)
    expect((await request(app, `${path}/contacts/missing/notes`)).status).toBe(404)
    expect((await write(app, `${path}/contacts/UPPER`, 'POST', { name: 'Bad', notes: [] })).status).toBe(422)
    expect((await write(app, `${path}/contacts/__proto__`, 'POST', { name: 'Bad', notes: [] })).status).toBe(422)
    expect((await request(app, `${path}/contacts/billing`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(app, `${path}/contacts/billing`)).status).toBe(404)
    expect((await request(app, `${path}/contact`, { method: 'DELETE' })).status).toBe(204)
    expect((await request(app, `${path}/contact/notes/${item.data.id}`)).status).toBe(404)
  } finally {
    app.close()
  }
})

test('managed child replacement retains only local identities and rolls back invalid containing documents', async () => {
  const Child = Resource.extend({ value: z.number() }).meta({ child: true })
  const Parent = Resource.extend({ left: z.array(Child), right: z.array(Child) })
    .refine((value) => value.left.reduce((sum, item) => sum + item.value, 0) <= 10)
    .meta({ name: 'parents' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/parents')

  try {
    const controller = app.register(Parent)
    const created = await write(app, '/parents', 'POST', {
      left: [{ value: 2, id: 'forged', createdAt: 'forged' }],
      right: [{ value: 1 }],
    })
    const original = Parent.parse(((await created.json()) as { data: unknown }).data)
    const first = original.left[0]

    expect(created.status).toBe(201)
    expect(first?.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first?.createdAt).not.toBe('forged')
    expect(first?.environmentDomain).toBe(original.environmentDomain)
    const path = `/parents/${original.id}`
    const retained = await write(app, path, 'PATCH', {
      left: [{ id: first?.id, value: 3, createdAt: 'forged', updatedAt: 'forged' }, { value: 1 }],
    })
    const updated = Parent.parse(((await retained.json()) as { data: unknown }).data)

    expect(retained.status).toBe(200)
    expect(updated.left[0]?.createdAt).toBe(first?.createdAt)
    expect(updated.left[0]?.updatedAt).not.toBe('forged')
    expect(updated.left[1]?.id).not.toBe(first?.id)

    for (const left of [
      [
        { id: first?.id, value: 1 },
        { id: first?.id, value: 1 },
      ],
      [{ id: original.right[0]?.id, value: 1 }],
      [{ id: crypto.randomUUID(), value: 1 }],
      [{ id: first?.id, value: 20 }],
      [{ value: 1, environmentDomain: original.environmentDomain }],
    ])
      expect((await write(app, path, 'PATCH', { left })).status).toBe(422)
    expect((await write(app, `${path}/left/${first?.id}`, 'PATCH', { value: 50 })).status).toBe(422)
    expect(Parent.parse((await controller.id(context, Parent, original.id)).data)).toEqual(updated)
    const getterChild = {
      value: 1,
      get environmentDomain(): undefined {
        delete (this as { environmentDomain?: undefined }).environmentDomain

        return undefined
      },
    }

    await expect(
      controller.update(context, Parent, { left: [getterChild] } as never, original.id),
    ).rejects.toMatchObject({
      status: 422,
    })
    expect(Parent.parse((await controller.id(context, Parent, original.id)).data)).toEqual(updated)
    const another = Parent.parse((await controller.create(context, Parent, { left: [{ value: 1 }], right: [] })).data)

    expect((await request(app, `/parents/${another.id}/left/${first?.id}`)).status).toBe(404)
    expect((await request(app, `/parents/${crypto.randomUUID()}/left`)).status).toBe(404)
    await app.configDatastore.environments.create('fixture.hedra.local', {
      name: 'Other',
      environmentDomain: 'other.fixture.hedra.local',
    })

    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const result = await request(app, `${path}/left/${first?.id}`, {
        method,
        headers: { ...headers, host: 'other.fixture.hedra.local' },
        ...(method === 'PATCH' ? { body: JSON.stringify({ value: 1 }) } : {}),
      })

      expect(result.status).toBe(404)
    }
    expect(Parent.parse((await controller.id(context, Parent, original.id)).data)).toEqual(updated)
  } finally {
    app.close()
  }
})

test('parent output governs child responses, including reordering, hidden values and committed failures', async () => {
  const Child = Resource.extend({ text: z.string(), password: z.string() }).meta({ child: true })
  const Parent = Resource.extend({ items: z.array(Child) }).meta({ name: 'parents' })
  const PublicChild = Child.omit({ password: true })
  let mode = 'reverse'
  const output = Parent.extend({ items: z.array(PublicChild) }).overwrite((value) => {
    if (mode === 'filter') return { ...value, items: value.items.filter((item) => item.text !== 'new') }
    if (mode === 'duplicate') return { ...value, items: [value.items[0], value.items[0]] as typeof value.items }
    if (mode === 'substitute')
      return { ...value, items: value.items.map((item) => ({ ...item, id: crypto.randomUUID() })) }

    return { ...value, items: [...value.items].reverse() }
  })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/parents')

  try {
    const controller = app.register(Parent, { output })
    const root = Parent.parse(
      (await controller.create(context, Parent, { items: [{ text: 'first', password: 'secret' }] })).data,
    )
    const path = `/parents/${root.id}/items`
    const created = await write(app, path, 'POST', { text: 'new', password: 'hidden' })
    const child = (await created.json()) as { data: { id: string; text: string; password?: string } }

    expect(created.status).toBe(201)
    expect(child.data.text).toBe('new')
    expect(child.data.password).toBeUndefined()
    expect((await created.headers.get('location'))?.endsWith(`/${child.data.id}`)).toBe(true)
    const list = (await (await request(app, path)).json()) as { data: Array<{ id: string; password?: string }> }

    expect(list.data.map((item) => item.id)).toEqual([child.data.id, z.string().parse(root.items[0]?.id)])
    expect(list.data.every((item) => item.password === undefined)).toBe(true)
    expect((await request(app, `${path}/${child.data.id}`)).status).toBe(200)
    mode = 'filter'
    expect((await request(app, `${path}/${child.data.id}`)).status).toBe(500)
    const failed = await write(app, path, 'POST', { text: 'new', password: 'hidden' })

    expect(failed.status).toBe(500)
    expect(await failed.json()).toMatchObject({
      errors: [{ detail: 'Transaction succeeded, but response validation failed.' }],
    })
    expect(Parent.parse((await controller.id(context, Parent, root.id)).data).items).toHaveLength(3)
    mode = 'duplicate'
    expect((await request(app, path)).status).toBe(500)
    mode = 'substitute'
    expect((await request(app, path)).status).toBe(500)
  } finally {
    app.close()
  }
})

test('hidden child fields fail closed and stripping request validators cannot erase submitted ownership', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Parent = Resource.extend({ child: Child.optional() }).meta({ name: 'parents' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/parents')

  try {
    const controller = app.register(Parent, {
      output: Parent.omit({ child: true }),
      create: z.object({ child: z.object({ value: z.string() }) }),
    })

    expect(
      (
        await write(app, '/parents', 'POST', {
          child: { value: 'hidden', environmentDomain: 'dev.fixture.hedra.local' },
        })
      ).status,
    ).toBe(422)
    const root = Parent.parse((await controller.create(context, Parent, { child: { value: 'secret' } })).data)
    const path = `/parents/${root.id}/child`

    expect((await request(app, path)).status).toBe(500)
    expect((await request(app, path, { method: 'DELETE' })).status).toBe(500)
    const mutation = await write(app, path, 'PATCH', { value: 'changed' })

    expect(mutation.status).toBe(500)
    expect(await mutation.json()).toMatchObject({
      errors: [{ detail: 'Transaction succeeded, but response validation failed.' }],
    })
    expect(Parent.parse((await controller.id(context, Parent, root.id)).data).child?.value).toBe('changed')
  } finally {
    app.close()
  }
})

test('direct controller creation applies empty managed defaults', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Parent = Resource.extend({ items: z.array(Child).default([]) }).meta({ name: 'parents' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/parents')

  try {
    const controller = app.register(Parent)
    const created = Parent.parse((await controller.create(context, Parent, {})).data)

    expect(created.items).toEqual([])
  } finally {
    app.close()
  }
})

test('fixed ordinary objects transparently contain children without acquiring managed metadata', async () => {
  const Address = Resource.extend({ street: z.string().meta({ name: 'A street label' }) }).meta({
    child: true,
    name: 'Postal address label',
  })
  const Root = Resource.extend({
    profile: z.object({ label: z.string(), addresses: z.array(Address) }).meta({ name: 'Profile label' }),
  }).meta({ name: 'roots' })
  const app = new Hedra({ config: new Config(quiet) })

  try {
    app.register(Root)
    const created = await write(app, '/roots', 'POST', {
      profile: { label: 'Personal', addresses: [{ street: 'First' }] },
    })

    expect(created.status).toBe(201)
    const root = Root.parse(((await created.json()) as { data: unknown }).data)
    const path = `/roots/${root.id}/profile/addresses`
    const added = await write(app, path, 'POST', { street: 'Second' })

    expect(added.status).toBe(201)
    expect((await request(app, path)).status).toBe(200)
    const stored = Root.parse(((await (await request(app, `/roots/${root.id}`)).json()) as { data: unknown }).data)

    expect(stored.profile.label).toBe('Personal')
    expect(Object.keys(stored.profile).sort()).toEqual(['addresses', 'label'])
    expect(stored.profile.addresses).toHaveLength(2)
    expect((await request(app, `/roots/${root.id}/profile`)).status).toBe(404)
  } finally {
    app.close()
  }
})

test('child output cannot substitute an ancestor identity while retaining its descendants', async () => {
  const Note = Resource.extend({ text: z.string() }).meta({ child: true })
  const Contact = Resource.extend({ notes: z.array(Note) }).meta({ child: true })
  const Root = Resource.extend({ contact: Contact }).meta({ name: 'roots' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, {
      output: Root.extend({ contact: Contact.overwrite((value) => ({ ...value, id: crypto.randomUUID() })) }),
    })
    const root = Root.parse(
      (await controller.create(context, Root, { contact: { notes: [{ text: 'Private' }] } })).data,
    )

    expect((await request(app, `/roots/${root.id}/contact/notes/${root.contact.notes[0]?.id}`)).status).toBe(500)
  } finally {
    app.close()
  }
})

test('model transformations cannot alter managed child metadata inside root or nested transactions', async () => {
  let corrupt = false
  const Child = Resource.extend({ value: z.string() })
    .overwrite((value) => (corrupt ? { ...value, environmentDomain: 'foreign.example.local' } : value))
    .meta({ child: true })
  const Parent = Resource.extend({ children: z.array(Child) }).meta({ name: 'parents' })
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/parents')

  try {
    const controller = app.register(Parent)
    const original = Parent.parse((await controller.create(context, Parent, { children: [{ value: 'Before' }] })).data)

    corrupt = true
    expect(
      (await write(app, `/parents/${original.id}/children/${original.children[0]?.id}`, 'PATCH', { value: 'After' }))
        .status,
    ).toBe(422)
    expect(
      (
        await write(app, `/parents/${original.id}`, 'PATCH', {
          children: [{ id: original.children[0]?.id, value: 'After' }],
        })
      ).status,
    ).toBe(422)
    expect((await write(app, '/parents', 'POST', { children: [{ value: 'New' }] })).status).toBe(422)
    corrupt = false
    expect(Parent.parse((await controller.id(context, Parent, original.id)).data)).toEqual(original)
    expect((await controller.list(context, Parent, context.req.url)).data).toHaveLength(1)
  } finally {
    app.close()
  }
})

test('scoped child controllers receive a detached complete root and path address', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ profile: z.object({ contacts: z.record(z.string(), Child) }) }).meta({ name: 'roots' })
  const seen: unknown[] = []

  class Observed extends BaseController {
    /** Checks that callers cannot mutate the stored request address through its accessor. */
    override async id(...args: Parameters<BaseController['id']>) {
      const scope = getResourceScope(args[0])

      seen.push(structuredClone(scope))
      if (scope?.target.kind === 'child') scope.target.steps[0] = { field: 'wrong', selector: { kind: 'object' } }

      return super.id(...args)
    }
  }
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { controller: Observed })
    const root = Root.parse(
      (await controller.create(context, Root, { profile: { contacts: { home: { value: 'Home' } } } })).data,
    )

    expect((await request(app, `/roots/${root.id}/profile/contacts/home`)).status).toBe(200)
    expect(seen).toEqual([
      {
        collection: 'roots',
        target: {
          kind: 'child',
          rootId: root.id,
          steps: [
            { field: 'profile', selector: { kind: 'object' } },
            { field: 'contacts', selector: { kind: 'dictionary', key: 'home' } },
          ],
        },
      },
    ])
  } finally {
    app.close()
  }
})

test('custom child snapshots must match the addressed root even when parent output omits its ID', async () => {
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Root = Resource.extend({ children: z.array(Child) }).meta({ name: 'roots' })
  let mode = 'valid'

  class Custom extends BaseController {
    /** Exercises the containing-root snapshot contract for custom item handlers. */
    override async id(...args: Parameters<BaseController['id']>) {
      const result = await super.id(...args)

      if (mode === 'wrong') return { ...result, data: { ...result.data, id: crypto.randomUUID() } }
      if (mode === 'json') return { ...result, data: { ...result.data, extra: 1n } } as never

      return result
    }
    /** Returns an invalid multi-root child list to check the web transport boundary. */
    override async list(...args: Parameters<BaseController['list']>) {
      const result = await super.list(...args)

      return mode === 'multiple' ? { ...result, data: [...result.data, ...result.data] } : result
    }
  }
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { controller: Custom, output: Root.omit({ id: true }) })
    const root = Root.parse((await controller.create(context, Root, { children: [{ value: 'Private' }] })).data)
    const path = `/roots/${root.id}/children`

    expect((await request(app, `${path}/${root.children[0]?.id}`)).status).toBe(200)

    for (const value of ['wrong', 'json']) {
      mode = value
      expect((await request(app, `${path}/${root.children[0]?.id}`)).status).toBe(500)
    }
    mode = 'multiple'
    expect((await request(app, path)).status).toBe(500)
  } finally {
    app.close()
  }
})

test('direct child-scoped controller calls reject nested ownership getters before serialization', async () => {
  const Leaf = Resource.extend({ value: z.string() }).meta({ child: true })
  const Branch = Resource.extend({ leaves: z.array(Leaf) }).meta({ child: true })
  const Root = Resource.extend({ branch: Branch }).meta({ name: 'roots' })
  let captured: Parameters<BaseController['update']>[0] | undefined

  class Observed extends BaseController {
    /** Saves the actual generated child request context for a direct public-controller call. */
    override async update(...args: Parameters<BaseController['update']>) {
      captured = args[0]

      return super.update(...args)
    }
  }
  const app = new Hedra({ config: new Config(quiet) })
  const context = await scopedContext('http://localhost/roots')

  try {
    const controller = app.register(Root, { controller: Observed })
    const original = Root.parse((await controller.create(context, Root, { branch: { leaves: [] } })).data)

    expect((await write(app, `/roots/${original.id}/branch`, 'PATCH', { leaves: [] })).status).toBe(200)
    if (!captured) throw new Error('Child controller context was not captured')
    const child = {
      value: 'Hidden owner',
      get environmentDomain(): undefined {
        delete (this as { environmentDomain?: undefined }).environmentDomain

        return undefined
      },
    }

    await expect(controller.update(captured, Root, { leaves: [child] } as never, original.id)).rejects.toMatchObject({
      status: 422,
    })
    expect(Root.parse((await controller.id(context, Root, original.id)).data).branch.leaves).toEqual([])
  } finally {
    app.close()
  }
})
