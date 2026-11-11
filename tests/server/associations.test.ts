import { expect, test } from 'bun:test'
import { z } from 'zod'

import type { Backend } from '#hedra.ts'
import { ConnectionError } from '#errors'
import { BaseController, Collection, Config, Hedra, Resource, SqliteBackend } from '#hedra.ts'

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
    const label = await create('/labels', { name: 'Urgent' })

    const link = await app.associations.link({ collection: 'projects', id: first }, { collection: 'labels', id: label })

    expect(
      await app.associations.link({ collection: 'projects', id: first }, { collection: 'labels', id: label }),
    ).toEqual(link)

    await app.associations.link({ collection: 'projects', id: second }, { collection: 'labels', id: label })
    const blocked = await app.request(`/labels/${label}`, { method: 'DELETE' })

    expect(blocked.status).toBe(409)
    expect((await app.request(`/projects/${first}`, { method: 'DELETE' })).status).toBe(409)
    expect(
      ((await blocked.json()) as { errors: Array<{ detail: { associations: unknown[] } }> }).errors[0]?.detail
        .associations,
    ).toHaveLength(2)
    await app.associations.unlink({ collection: 'projects', id: first }, { collection: 'labels', id: label })
    expect((await app.request(`/labels/${label}`, { method: 'DELETE' })).status).toBe(409)
    await app.associations.unlink({ collection: 'projects', id: second }, { collection: 'labels', id: label })
    expect((await app.request(`/labels/${label}`, { method: 'DELETE' })).status).toBe(204)
    expect((await app.request(`/projects/${first}`)).status).toBe(200)
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
  const labels = new Collection('labels', Resource.extend({ name: z.string() }))
  const projects = new Collection('projects', Resource.extend({ title: z.string() }), {
    controller: SometimesFails,
    associations: [labels],
  })

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
