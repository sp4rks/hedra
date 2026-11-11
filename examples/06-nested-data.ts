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

  // Nested values have no generated endpoints; a parent PATCH replaces the supplied attribute.
  const updated = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notes: [{ text: 'Reviewed draft' }] }),
  })

  // The new notes replace the old array; omitted namedNotes and summary remain unchanged.
  Project.parse(JsonApiResponse.parse(await updated.json()).data)

  const found = await app.request(path)

  Project.parse(JsonApiResponse.parse(await found.json()).data)

  // Independent resources retain explicit links and deletion protection.
  const createdLabel = await app.request('/labels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Urgent' }),
  })
  const label = Label.parse(JsonApiResponse.parse(await createdLabel.json()).data)
  const source = { collection: 'projects', id: project.id }
  const target = { collection: 'labels', id: label.id }

  await app.associations.link(source, target)
  await app.associations.list(source)

  // Remove the link before deleting either endpoint.
  await app.associations.unlink(source, target)
  await app.request(`/labels/${label.id}`, { method: 'DELETE' })
  await app.request(path, { method: 'DELETE' })
} finally {
  app.close()
  backend.close()
}
