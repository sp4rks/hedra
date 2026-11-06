import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Backend } from '#hedra.ts'
import { ConnectionError } from '#errors'
import { BaseController, Collection, Config, EmbeddedResource, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const quiet = { HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }
const headers = { 'content-type': 'application/json' }

test('associated resources can be shared and block deletion until unlinked', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const labels = new Collection('labels', Resource.extend({ name: z.string() }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })
  const create = async (path: string, body: object) => {
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })

    expect(response.status).toBe(201)

    return ((await response.json()) as { data: { id: string } }).data.id
  }

  try {
    app.register(projects)
    const first = await create('/projects', { title: 'First' })
    const second = await create('/projects', { title: 'Second' })
    const label = await create(`/projects/${first}/labels`, { name: 'Urgent' })

    await app.associations.link({ collection: 'projects', id: second }, { collection: 'labels', id: label })
    expect((await app.request(`/projects/${first}/labels/${label}`)).status).toBe(200)
    expect((await app.request(`/projects/${second}/labels/${label}`)).status).toBe(200)
    const blocked = await app.request(`/labels/${label}`, { method: 'DELETE' })

    expect(blocked.status).toBe(409)
    expect(
      ((await blocked.json()) as { errors: Array<{ detail: { associations: unknown[] } }> }).errors[0]?.detail
        .associations,
    ).toHaveLength(2)
    expect((await app.request(`/projects/${first}/associations/labels/${label}`, { method: 'DELETE' })).status).toBe(
      204,
    )
    expect((await app.request(`/labels/${label}`, { method: 'DELETE' })).status).toBe(409)
    await app.associations.unlink({ collection: 'projects', id: second }, { collection: 'labels', id: label })
    expect((await app.request(`/labels/${label}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/projects/${first}`)).status).toBe(200)
  } finally {
    app.close()
    backend.close()
  }
})

test('embedded resources under associated resources require every link in their ancestry', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Note = EmbeddedResource.extend({ text: z.string() })
  const labels = new Collection('labels', Resource.extend({ name: z.string(), notes: z.array(Note).default([]) }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })
  const create = async (path: string, body: object) => {
    const response = await app.request(path, { method: 'POST', headers, body: JSON.stringify(body) })

    expect(response.status).toBe(201)

    return ((await response.json()) as { data: { id: string } }).data.id
  }

  try {
    app.register(projects)
    const first = await create('/projects', { title: 'First' })
    const second = await create('/projects', { title: 'Second' })
    const label = await create(`/projects/${first}/labels`, { name: 'Urgent' })
    const note = await create(`/projects/${first}/labels/${label}/notes`, { text: 'hello' })

    expect((await app.request(`/projects/${first}/labels/${label}/notes/${note}`)).status).toBe(200)
    expect((await app.request(`/projects/${second}/labels/${label}/notes/${note}`)).status).toBe(404)
    expect(
      (
        await app.request(`/projects/${second}/labels/${label}/notes`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'bad' }),
        })
      ).status,
    ).toBe(404)
    const direct = await app.request(`/labels/${label}/notes`)

    expect(((await direct.json()) as { data: unknown[] }).data).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})

test('nested associated creation leaves neither resource nor link when output validation fails', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Label = Resource.extend({ name: z.string() })
  const labels = new Collection('labels', Label, { outputValidator: Label.refine((value) => value.name !== 'bad') })
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })

  try {
    app.register(projects)
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'First' }),
    })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const failed = await app.request(`/projects/${id}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'bad' }),
    })

    expect(failed.status).toBe(500)
    expect(((await (await app.request('/labels')).json()) as { data: unknown[] }).data).toEqual([])
    expect(await app.associations.list({ collection: 'projects', id })).toEqual([])
    const missing = await app.request(`/projects/${crypto.randomUUID()}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: 'good' }),
    })

    expect(missing.status).toBe(404)
    expect(((await (await app.request('/labels')).json()) as { data: unknown[] }).data).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})

test('failed graph registration leaves every collection reusable', async () => {
  const backend = new SqliteBackend(':memory:')
  const first = new Hedra({ config: new Config(quiet), backend })
  const second = new Hedra({ config: new Config(quiet), backend })
  let fails = true

  class SometimesFails extends BaseController {
    constructor(selected: Backend) {
      super(selected)
      if (fails) throw new Error('cannot construct')
    }
  }
  const labels = new Collection('labels', Resource.extend({ name: z.string() }), { controller: SometimesFails })
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })

  try {
    expect(() => first.register(projects)).toThrow('cannot construct')
    expect(() => projects.controller).toThrow('registered')
    expect(() => labels.controller).toThrow('registered')
    expect((await first.request('/projects')).status).toBe(404)
    expect((await first.request('/labels')).status).toBe(404)
    fails = false
    second.register(projects)
    expect((await second.request('/projects')).status).toBe(200)
    expect((await second.request('/labels')).status).toBe(200)
  } finally {
    first.close()
    second.close()
    backend.close()
  }
})

test('saved association operations stop with the app while a borrowed backend remains usable', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const labels = new Collection('labels', Resource.extend({ name: z.string() }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), { associations: [labels] })

  try {
    app.register(projects)
    const created = await app.request('/projects', {
      method: 'POST',
      headers,
      body: JSON.stringify({ title: 'First' }),
    })
    const id = ((await created.json()) as { data: { id: string } }).data.id
    const saved = app.associations

    app.close()
    await expect(saved.list({ collection: 'projects', id })).rejects.toBeInstanceOf(ConnectionError)
    await expect(saved.list({ collection: 'projects', id })).rejects.toMatchObject({
      status: 500,
      title: 'Hedra is closed',
    })
    expect(await backend.select('projects')).toHaveLength(1)
  } finally {
    app.close()
    backend.close()
  }
})
