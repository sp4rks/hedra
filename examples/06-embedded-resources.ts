import assert from 'node:assert/strict'
import { z } from 'zod'

import {
  Association,
  Collection,
  EmbeddedResource,
  ErrorResponse,
  Hedra,
  JsonApiListResponse,
  JsonApiResponse,
  Resource,
  SqliteBackend,
} from '#hedra.ts'

const NoteModel = EmbeddedResource.extend({ text: z.string().trim().min(1) })
const LabelModel = Resource.extend({ name: z.string().min(1) })
const ProjectModel = Resource.extend({
  title: z.string().min(1),
  notes: z.array(NoteModel).default([]),
  namedNotes: z.record(z.string(), NoteModel).default({}),
  summary: NoteModel.optional(),
})
const labels = new Collection('labels', LabelModel)
const projects = new Collection('projects', ProjectModel, { associations: [labels] })
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })

// Referenced collections are registered too; embedded values remain inside their project's document.
app.register(projects)

try {
  const response = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: 'Launch',
      notes: [{ text: ' First draft ' }],
      namedNotes: { brief: { text: 'Keep it small' } },
      summary: { text: 'Prepare the launch' },
    }),
  })
  const project = ProjectModel.parse(JsonApiResponse.parse(await response.json()).data)
  const note = project.notes[0]

  assert.equal(response.status, 201)
  assert(note)
  assert.equal(note.text, 'First draft')
  assert.equal((await app.request(`/projects/${project.id}/notes/${note.id}`)).status, 200)
  assert.equal((await app.request('/notes')).status, 404)

  // Dictionary paths select the key; their values still have generated UUIDs.
  const createdNote = await app.request(`/projects/${project.id}/namedNotes?key=planning`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Check the release date' }),
  })
  const planning = NoteModel.parse(JsonApiResponse.parse(await createdNote.json()).data)
  const foundNote = await app.request(`/projects/${project.id}/namedNotes/planning`)

  assert.equal(createdNote.status, 201)
  assert.deepEqual(NoteModel.parse(JsonApiResponse.parse(await foundNote.json()).data), planning)
  const dictionary = await app.request(`/projects/${project.id}/namedNotes`)
  const namedNotes = z.record(z.string(), NoteModel).parse(JsonApiListResponse.parse(await dictionary.json()).data)

  assert.equal(namedNotes.planning?.id, planning.id)
  assert.equal(namedNotes.brief?.text, 'Keep it small')

  // A single embedded value uses its field path without another ID segment.
  const summary = await app.request(`/projects/${project.id}/summary`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Launch is ready' }),
  })

  assert.equal(summary.status, 200)
  assert.equal(NoteModel.parse(JsonApiResponse.parse(await summary.json()).data).id, project.summary?.id)

  // Nested association creation stores a separate label and links it to this project.
  const createdLabel = await app.request(`/projects/${project.id}/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Urgent' }),
  })
  const label = LabelModel.parse(JsonApiResponse.parse(await createdLabel.json()).data)
  const secondResponse = await app.request('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Follow-up' }),
  })
  const second = ProjectModel.parse(JsonApiResponse.parse(await secondResponse.json()).data)

  assert.equal(createdLabel.status, 201)
  await app.associations.link({ collection: 'projects', id: second.id }, { collection: 'labels', id: label.id })
  assert.equal((await app.request(`/projects/${second.id}/labels/${label.id}`)).status, 200)
  const blocked = await app.request(`/labels/${label.id}`, { method: 'DELETE' })
  const errors = ErrorResponse.parse(await blocked.json())
  const detail = z.object({ associations: z.array(Association) }).parse(errors.errors[0]?.detail)

  assert.equal(blocked.status, 409)
  assert.equal(detail.associations.length, 2)

  // Unlinking retains both resources; every link must be removed before deleting either endpoint.
  assert.equal(
    (await app.request(`/projects/${project.id}/associations/labels/${label.id}`, { method: 'DELETE' })).status,
    204,
  )
  assert.equal((await app.request(`/labels/${label.id}`, { method: 'DELETE' })).status, 409)
  await app.associations.unlink({ collection: 'projects', id: second.id }, { collection: 'labels', id: label.id })
  assert.equal((await app.request(`/labels/${label.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await app.request(`/projects/${project.id}`, { method: 'DELETE' })).status, 204)
  assert.equal((await app.request(`/projects/${project.id}/namedNotes/planning`)).status, 404)
  assert.equal((await app.request(`/projects/${second.id}`)).status, 200)
} finally {
  app.close()
  backend.close()
}
