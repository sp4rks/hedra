# Collections and REST controllers

A Collection names an independently stored resource type and selects its model, controller and public output. Register it with Hedra to construct its controller and expose root CRUD routes. Nested objects are ordinary attributes of that resource.

```ts
import { z } from 'zod'

import { Collection, Hedra, Resource } from '#hedra.ts'

const CarModel = Resource.extend({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})

type CarModel = z.infer<typeof CarModel>

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()

hedra.register(cars)
```

Resource defines a UUID `id` and ISO `createdAt`/`updatedAt` timestamps. Models define stored data and inferred types; controllers remain independent of resource types. Collection names start with a lowercase letter and contain lowercase letters, digits, underscores or hyphens. A collection named `cars` uses the `cars` table and `/cars` endpoint.

## REST operations

ControllerInterface defines five asynchronous methods. Each receives a Hono Context and Collection; BaseController receives the shared Backend at construction.

| Method | Behaviour | Result |
| --- | --- | --- |
| `create(context, collection, input)` | Assign a fresh UUID and timestamps, validate and insert. | JsonApiResponse |
| `id(context, collection, id)` | Return the addressed resource. | JsonApiResponse |
| `list(context, collection, baseUrl, queryParams?)` | Return resources matching scalar equality filters. | JsonApiListResponse |
| `update(context, collection, input, id)` | Shallowly update the addressed resource. | JsonApiResponse |
| `delete(context, collection, id)` | Delete after checking references. | void |

The positional `id` is always the independently stored resource's UUID. Single responses contain flat attributes in `data` and a `links.self` URL. List `data` is always an array. Missing resources throw 404; DELETE resolves without a value. The [HTTP reference](web-layer.md) defines statuses, headers and errors.

Create and update ignore caller-supplied root `id`, `createdAt` and `updatedAt`. Creation assigns the same current timestamp to both audit fields. Update preserves identity and creation time, refreshes `updatedAt`, retains omitted top-level attributes and replaces supplied attributes as a whole. Any association blocks deletion until explicitly unlinked.

## Nested data and validation

Define nested fields with ordinary Zod schemas. Resource-derived schemas can be nested too; their declared fields follow the same rules as any other nested data. For a nested value without resource metadata:

```ts
const Note = Resource.extend({ text: z.string().trim().min(1) }).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
})
const Project = Resource.extend({ title: z.string(), notes: z.array(Note).default([]) })
const projects = new Collection('projects', Project)
```

There is no child Collection or `parent` option. Read nested data through GET `/projects/:id`; replace it through PATCH `/projects/:id`. Supplying `notes` replaces the whole array. No child IDs, timestamps, identity matching or partial child updates are performed by Hedra. If the nested schema declares required metadata, the caller or schema defaults must supply it. See [replacing nested values](web-layer.md#replacing-nested-values).

Generated routes derive create/PATCH validators from the addressed model, omitting root managed fields. Create applies required fields, normalisation and defaults. PATCH validates supplied fields without filling omitted defaults. Controllers validate the complete proposed resource inside the write transaction, including rules spanning current and changed fields. Invalid candidates return 422; output failures return 500 and abort writes. See [atomic candidate validation](adr/0012-atomic-candidate-validation.md).

Models describe the [stable stored representation](adr/0003-models-describe-stored-records.md). Their parsed values must remain valid under the same model. Root identity and audit fields cannot be changed by model transforms. Nested values use normal model validation, without special resource-placement or identity restrictions.

QueryParams accepts only `filter`, a dictionary of top-level scalar equality criteria. All criteria must match; strings, numbers, booleans and null retain their types. Field names are literal. HTTP filters must name declared public fields. Nested filters, pagination, sorting and comparisons are not supplied. See [filter requests](web-layer.md#filters).

## Public output

BaseController projects every returned resource through the collection's output validator, including each list item. Its default includes the model's declared top-level fields except `password` and strips undeclared top-level fields. The default object does not carry the model's object-level refinements, which may depend on the omitted password.

Nested fields keep their declared Zod schemas. Their passwords, dictionary entries, defaults, catch fallbacks and transformations follow those schemas; a loose nested object can expose undeclared fields. Hedra does not infer nested privacy or reject unions and intersections merely because their public shape is ambiguous. Fields such as `token` are public by default too.

Select an explicit output validator for resource-specific privacy. BaseController applies it to create, item reads, lists and updates:

```ts
const Profile = z.object({ displayName: z.string(), password: z.string(), token: z.string() }).loose()
const Account = Resource.extend({ email: z.email(), password: z.string(), token: z.string(), profile: Profile })
const accounts = new Collection('accounts', Account, {
  outputValidator: Account.omit({ password: true, token: true })
    .extend({ profile: Profile.pick({ displayName: true }).strip() })
    .strip(),
})
```

An explicit output validator defines its public fields, including nested fields, and can deliberately expose a top-level password. Custom controllers own their response policy; methods that delegate to BaseController use the selected collection validator. Protect every response path when implementing custom methods. Models describe stored data and do not confer secrecy on a field or resource type.

Projection uses a clone so output transforms cannot mutate storage. Invalid output raises an error without falling back to raw data; create and update validate output before their transactions commit. Private values remain stored. An exposed root ID must remain equal to the stored ID; nested values have no separate identity contract. Run `bun run examples/08-public-output.ts` from the repository root for a complete example.

When updating an existing application, review nested response schemas before adopting this policy. Previous default output recursively hid nested passwords and undeclared object fields; those values can now appear if their declared schemas allow them. Select an explicit nested output schema or enforce the equivalent policy in the controller. See [controller-owned public output](adr/0031-controller-owned-public-output.md).

## Resource scope

`getResourceScope(context)` returns the generated request's data-only address. ResourceScope provides both its Zod schema and inferred type:

```ts
{ collection: 'cars', target: { kind: 'collection' } }
{ collection: 'cars', target: { kind: 'resource', id: carId } }
```

GET list and POST use the collection target. GET item, PATCH and DELETE use the resource target. There are no embedded selectors or association ancestors. Accessors return validated, detached values; changing one does not change request context. Scope describes an address, not existence or authorisation. Custom Hono routes and direct controller calls have no generated scope automatically. See the [custom-controller example](../examples/07-resource-scope.ts).

## Controller selection and lifecycle

Collection options accept a `controller` class constructed with `(backend)`, an `outputValidator`, and declared `associations`. Extra controller methods retain their inferred types. Generated root handlers pass the selected Collection and dispatch through its controller. Custom application routes can call additional controller methods.

Register collections and custom routes before handling requests. Accessing `collection.controller` before registration throws. Registration includes referenced independent collections and validates the complete declaration graph before constructing controllers. It rejects duplicate names, reserved names, cycles and collection-instance reuse across apps. Referencing a collection already registered in the same app is allowed; explicitly registering it again rejects. Constructor failure leaves pending controllers and routes unattached and reusable. Lifecycle members marked `@internal` belong to the framework.

Hedra lazily opens its default SQLite backend on first application collection registration. Injected backends are borrowed. Closing Hedra invalidates saved controllers and association handles, and closes only owned dependencies. See [connection ownership](backends.md#connection-ownership), [server configuration](configuration.md) and the separate [configuration datastore](config-store.md).

## Run the examples

From the repository root with Bun and dependencies installed:

```sh
bun run examples/05-resource-controller.ts
bun run examples/06-nested-data.ts
bun run examples/07-resource-scope.ts
bun run examples/08-public-output.ts
```

Each example uses in-memory SQLite, makes requests without a listener and closes its resources. The nested-data example replaces parent attributes and links and unlinks independent resources. The scope example shows a custom controller and its additional typed method. The public-output example selects nested public fields for create, read, list and update responses, then reads the complete stored model.

## Updating existing callers

Remove parent-declared collections and calls to generated nested endpoints. Those URLs now return 404. Change nested values by supplying the complete replacement attribute to the parent's PATCH. Supply any nested fields your model requires; only the addressed resource receives server-managed metadata.

EmbeddedStep, EmbeddedScope, AssociationScope, getEmbeddedScope and getAssociationScope are removed. ResourceScope has only `collection` and `target`, with collection/resource targets. Dictionary-list response data is removed. Existing five-method controller calls and programmatic association link/list/unlink remain; use programmatic unlink instead of the removed nested unlink route.

Existing JSON and association records are retained. No table deletion, data rewrite or automatic migration occurs. See [ADR 0030](adr/0030-root-crud-and-ordinary-nested-data.md).
