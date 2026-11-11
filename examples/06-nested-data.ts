import assert from 'node:assert/strict'
import { z } from 'zod'

import { Collection, Hedra, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

const Note = Resource.extend({ text: z.string().trim().min(1) }).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
const Label = Resource.extend({ name: z.string().min(1) })
const Project = Resource.extend({
  title: z.string(),
  notes: z.array(Note).default([]),
  namedNotes: z.record(z.string(), Note).default({}),
  summary: Note.optional(),
})
const labels = new Collection('labels', Label)
const projects = new Collection('projects', Project, { associations: [labels] })
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const headers = { 'content-type': 'application/json' }

app.register(projects)

try {
  const created = await app.request('/projects', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: 'Launch',
      notes: [{ text: ' First draft ' }],
      namedNotes: { brief: { text: 'Keep it small' } },
      summary: { text: 'Prepare the launch' },
    }),
  })
  const project = Project.parse(JsonApiResponse.parse(await created.json()).data)
  const path = `/projects/${project.id}`

  assert.equal(created.status, 201)
  assert.deepEqual(project.notes, [{ text: 'First draft' }])

  // A parent PATCH replaces the supplied attribute and retains omitted attributes.
  const updated = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notes: [{ text: 'Reviewed draft' }] }),
  })
  const changed = Project.parse(JsonApiResponse.parse(await updated.json()).data)

  assert.equal(updated.status, 200)
  assert.deepEqual(changed.notes, [{ text: 'Reviewed draft' }])
  assert.deepEqual(changed.namedNotes, project.namedNotes)
  assert.deepEqual(changed.summary, project.summary)

  // Nested values have no generated endpoints; edits go through the parent.
  for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
    assert.equal((await app.request(`${path}/notes`, { method })).status, 404)
  }

  const found = await app.request(path)

  assert.deepEqual(Project.parse(JsonApiResponse.parse(await found.json()).data), changed)

  // Independent resources retain explicit links and deletion protection.
  const createdLabel = await app.request('/labels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Urgent' }),
  })
  const label = Label.parse(JsonApiResponse.parse(await createdLabel.json()).data)
  const source = { collection: 'projects', id: project.id }
  const target = { collection: 'labels', id: label.id }

  assert.equal(createdLabel.status, 201)
  await app.associations.link(source, target)
  assert.equal((await app.associations.list(source)).length, 1)
  assert.equal((await app.request(`/labels/${label.id}`, { method: 'DELETE' })).status, 409)
  assert.equal((await app.request(path, { method: 'DELETE' })).status, 409)
  assert.equal((await app.request(`${path}/labels`)).status, 404)
  assert.equal((await app.request(`${path}/associations/labels/${label.id}`, { method: 'DELETE' })).status, 404)

  await app.associations.unlink(source, target)
  assert.equal((await app.request(`/labels/${label.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await app.request(path, { method: 'DELETE' })).status, 204)
} finally {
  app.close()
  backend.close()
}
