// Store nested notes inside a project and link labels as independent resources.
// Parent writes replace nested values; associations connect resources with separate lifetimes.

import { z } from 'zod'

import { Collection, Hedra, JsonApiResponse, Resource, SqliteBackend } from '#hedra.ts'

// Notes are ordinary nested values, so their schema omits resource IDs and timestamps.
const Note = Resource.extend({ text: z.string().trim().min(1) }).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
// Labels keep their metadata because they are stored in their own collection.
const Label = Resource.extend({ name: z.string().min(1) })
// Describe arrays, keyed notes and an optional summary directly in the project's schema.
const Project = Resource.extend({
  title: z.string(),
  notes: z.array(Note).default([]),
  namedNotes: z.record(z.string(), Note).default({}),
  summary: Note.optional(),
})
// Declaring the association lets project registration also register the labels collection.
const labels = new Collection('labels', Label)
const projects = new Collection('projects', Project, { associations: [labels] })
// Use in-memory SQLite and make requests without opening a network listener.
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })
const headers = { 'content-type': 'application/json' }

app.register(projects)

try {
  // Create a project with an array, a dictionary and a single nested note.
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

  // Update notes through the parent route; nested values have no generated endpoints.
  const updated = await app.request(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ notes: [{ text: 'Reviewed draft' }] }),
  })

  // The new notes replace the old array; omitted namedNotes and summary remain unchanged.
  Project.parse(JsonApiResponse.parse(await updated.json()).data)

  // Read back the project with its replaced notes and retained nested fields.
  const found = await app.request(path)

  Project.parse(JsonApiResponse.parse(await found.json()).data)

  // Create an independent label and address both resources by their collection and ID.
  const createdLabel = await app.request('/labels', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'Urgent' }),
  })
  const label = Label.parse(JsonApiResponse.parse(await createdLabel.json()).data)
  const source = { collection: 'projects', id: project.id }
  const target = { collection: 'labels', id: label.id }

  // Link the project to the label, then list the project's links.
  await app.associations.link(source, target)
  await app.associations.list(source)

  // Unlink before deleting either endpoint; linked resources are protected from deletion.
  await app.associations.unlink(source, target)
  await app.request(`/labels/${label.id}`, { method: 'DELETE' })
  await app.request(path, { method: 'DELETE' })
} finally {
  // Close the app's controllers, then release its borrowed backend.
  app.close()
  backend.close()
}
