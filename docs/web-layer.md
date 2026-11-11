# Generated resource HTTP routes

Register a Collection to expose CRUD for independently stored resources. Nested objects, arrays and dictionaries remain attributes of their containing resource. Hedra generates no nested CRUD or association-navigation routes. The runtime remains one Bun process with Hono, Zod and the configured backend.

The [Tenant API](tenants.md) is built in and uses the configuration catalogue without application collection registration.

## Define a resource with nested data

```ts
import { z } from 'zod'

import { Collection, Hedra, Resource, SqliteBackend } from '#hedra.ts'

const Note = Resource.extend({ text: z.string().trim().min(1) }).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
const Label = Resource.extend({ name: z.string().min(1) })
const Project = Resource.extend({
  title: z.string().min(1),
  notes: z.array(Note).default([]),
  namedNotes: z.record(z.string(), Note).default({}),
  summary: Note.optional(),
})
const labels = new Collection('labels', Label)
const projects = new Collection('projects', Project, { associations: [labels] })
const backend = new SqliteBackend(':memory:')
const app = new Hedra({ backend })

app.register(projects)
```

Registration also exposes labels through its independent root routes. Notes stay inside each project's JSON document. The Note model omits metadata because these values need only text; nested Resource models that retain required metadata must receive it from input or schema defaults. Nested schemas follow ordinary Zod semantics, without a second resource type or child collection declaration.

Close the app and borrowed backend when finished. For an executable version, run `bun run examples/06-nested-data.ts` from the repository root.

## Requests and responses

| Path | Methods | Behaviour |
| --- | --- | --- |
| `/projects` | GET, POST | List/create projects. |
| `/projects/:projectId` | GET, PATCH, DELETE | Read/update/delete a project, including its nested data. |
| `/labels` | GET, POST | List/create independently stored labels. |
| `/labels/:labelId` | GET, PATCH, DELETE | Read/update/delete a label. |

POST and PATCH accept a JSON attribute object with a JSON content type. POST returns 201 and a Location header; GET/PATCH return 200. DELETE returns 204 with no body. JsonApiResponse contains flat attributes in `data` and a self link. JsonApiListResponse contains an array in `data`, even when individual attributes contain dictionaries.

Paths below an item, including `/projects/:id/notes`, `/projects/:id/labels` and nested association unlink paths, return 404 for every method unless the consuming application explicitly adds a custom route.

| Status | Cause |
| --- | --- |
| 400 | Malformed JSON. |
| 404 | Missing resource or route. |
| 409 | Associations block deletion. |
| 415 | Unsupported request content type. |
| 422 | Invalid attributes, resource UUID, query options or complete candidate. |
| 500 | Internal or output-validation failure. |

Generated errors follow ErrorResponse: an `errors` envelope containing status, title and optional detail. Deletion conflicts report blocking association references, without private resource attributes. Internal failures return a generic 500 envelope.

## Filters

Pass one JSON `filter` query parameter:

```ts
const query = new URLSearchParams({ filter: JSON.stringify({ title: 'Launch' }) })
const response = await app.request(`/projects?${query}`)
```

Filters use equality on declared public top-level scalar fields. All criteria must match. Strings, numbers, booleans and null remain distinct. Duplicate parameters, private/undeclared fields, nested filter values and unsupported options reject. Omitted fields do not acquire defaults. Pagination, sorting and comparison operators are not provided.

## Replacing nested values

PATCH preserves omitted top-level attributes and replaces supplied attributes as a whole:

```ts
await app.request(`/projects/${projectId}`, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ notes: [{ text: 'Reviewed draft' }] }),
})
```

That request replaces the complete notes array and retains title, namedNotes and summary. An object or dictionary is replaced in the same way; omitted keys inside the supplied replacement do not preserve their previous values. Use an empty array/object or an allowed null value to clear a container. Requiredness and minimum-size constraints still apply.

Only the addressed resource gets server-managed identity and audit timestamps. Nested IDs/timestamps are ordinary model data, with no generated values, reconciliation or automatic refresh. A nested model may generate its own defaults if the application wants them.

The controller validates the complete resulting resource inside its write transaction, including rules spanning stored and changed fields. Validation, projection or storage failure leaves the previous document unchanged. See [atomic validation](adr/0012-atomic-candidate-validation.md).

## Associations and deletion

Associations connect independently stored resources and retain their separate lifetimes. Create each endpoint through its canonical root route, then link it programmatically:

```ts
const source = { collection: 'projects', id: projectId }
const target = { collection: 'labels', id: labelId }

await app.associations.link(source, target)
const links = await app.associations.list(source)
```

Both endpoints must exist and use a declared association between registered collections. Linking the same pair is idempotent. Associations create no nested routes. The API does not infer references from arbitrary UUID-valued attributes.

**Any association blocks deletion of either endpoint.** DELETE returns 409 with the blocking associations until all links are removed:

```ts
await app.associations.unlink(source, target)
await app.request(`/labels/${labelId}`, { method: 'DELETE' })
```

Unlinking preserves both resources and unrelated links. There are no generated HTTP link/unlink endpoints. Nested document attributes disappear with their containing resource; independently stored resources are never cascade-deleted.

## Output and lifecycle

Public output preserves password filtering, explicit output schemas and failure rollback. Nested values have no special identity restrictions; an exposed root ID must still identify the addressed resource. See [public output](collections.md#public-output).

Custom controllers use [ResourceScope](collections.md#resource-scope) to inspect the addressed collection or UUID. Closing Hedra invalidates its controllers and association handles; borrowed dependencies remain the creator's responsibility. See [storage transactions](backends.md#transactions-across-records).

This interface adds no authentication, middleware or tenant selection. Consuming applications can register ordinary Hono routes for additional behaviour. See [ADR 0030](adr/0030-root-crud-and-ordinary-nested-data.md).
