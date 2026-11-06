# Web layer, embedded resources and associations

Status: behaviour agreed with the user. The lead accepts this interface and public test design for implementation. Main integration requires the user's approval.

## Agreed behaviour

Hedra generates resource routes from collection definitions. Web validates requests, handles HTTP, calls the selected controller and returns its response. Controllers own resource behaviour, association handling, managed fields and output projection. Use Bun, Hono and Zod. Cookies, middleware, authentication and tenant resolution are outside this increment.

- `Resource` has independent storage, a collection/root route and association support.
- `EmbeddedResource` is contained within another resource, shares its lifetime and has only nested routes. Its containing schema determines its shape: a single value, array or dictionary. It has no independent table, collection or associations and can contain further embedded resources. Arrays use UUID item paths; dictionaries use their keys; single values use their field path.
- Both are Zod schemas with inferred types and server-managed UUIDs/creation/update timestamps. The distinction is definition metadata, rather than a discriminator supplied in stored payloads.
- Collection paths expose GET/list and POST/create. Item paths expose GET/id, PATCH/update and DELETE/delete. All ancestors must exist; controllers enforce ancestry.
- Parent create/PATCH may contain embedded values. Supplying a container in PATCH replaces that container; nested operations edit one item. Deleting the containing resource removes its embedded values.
- Associations connect independent Resources. Nested association routes navigate links without ownership or exclusivity. Nested lists contain only associated resources; missing associations return 404. Nested POST creates a resource and its association.
- Any association involving a Resource blocks its deletion, including the association traversed by a nested URL. Return 409 reporting the blockers; unlink first. Deletion never cascades into deleting associated Resources. Embedded containment is separate and does not block deletion of its owner.
- Cardinality/exclusivity policies and an HTTP endpoint for linking existing Resources remain deferred.

ADR 0010 records the independent/embedded lifetime decision. ADR 0009's independent REST controller interface remains in force; ADR 0012 revises validation placement so web validates request fields and controllers validate complete candidate resources atomically.

## Definition and registration interface

Preserve the existing schema-extension and collection conventions:

```ts
const NoteModel = EmbeddedResource.extend({ text: z.string().trim().min(1) })
const TagModel = Resource.extend({ name: z.string().trim().min(1) })
const CarModel = Resource.extend({
  make: z.string(),
  notes: z.array(NoteModel).default([]),
  notesByName: z.record(z.string(), NoteModel).default({}),
  summary: NoteModel.optional(),
})

const tags = new Collection('tags', TagModel)
const cars = new Collection('cars', CarModel, { associations: [tags] })

app.register(cars)
```

Embedded field names supply nested path segments. Ordinary arrays/dictionaries remain attributes and gain no resource routes. The embedded-definition marker must survive normal schema extension; use a marker on the inherited identity field if necessary, rather than relying on object metadata which `.extend()` drops. Classification metadata must not appear in stored payloads. Preserve support for ordinary hand-written resource models requiring a UUID, while rejecting EmbeddedResource definitions as independent collections and independently marked Resource objects embedded as owned values.

Keep existing controller/output-validator options; add declared association target collections. Their names supply association-navigation path segments. Registration includes their root routes. Preserve duplicate-name, instance-reuse, reserved-table, connection-ownership and shutdown rules. A previously registered target in the same app can be referenced; explicitly registering it twice still rejects. Reject ambiguous segments and cyclic route definitions before binding routes/controllers. Support finite hierarchies of any declared depth.

## HTTP interface

| Request | Behaviour |
| --- | --- |
| GET /cars | List; 200 with existing JsonApiListResponse. |
| POST /cars | Create; 201 with existing JsonApiResponse and Location. |
| GET/PATCH /cars/:id | Read/update; 200 with JsonApiResponse. |
| DELETE /cars/:id | Delete; 204 without body, or 409 reporting blocking links. |
| GET/POST /cars/:carId/notes | Embedded list/create with the same conventions. |
| GET/PATCH/DELETE /cars/:carId/notes/:noteId | Embedded item operations scoped to the containing document. |
| GET /cars/:carId/notesByName | Embedded dictionary; retain dictionary keys in response data. |
| POST /cars/:carId/notesByName?key=service | Create a dictionary entry with its requested validated key; 409 if occupied. |
| GET/PATCH/DELETE /cars/:carId/notesByName/:key | Dictionary item operations by key. |
| GET/POST/PATCH/DELETE /cars/:carId/summary | Single embedded value; POST creates an absent value and rejects an occupied one with 409. |
| GET/POST /cars/:carId/tags | Associated list/create. |
| GET/PATCH/DELETE /cars/:carId/tags/:tagId | Associated item operations. DELETE still means Resource deletion, subject to association guards. |
| DELETE /cars/:carId/associations/tags/:tagId | Unlink while retaining both Resources; 204 or 404 if a resource/link is absent. |

Reserve the associations control segment where those routes are generated. Resource root paths remain available alongside navigation paths. EmbeddedResource has no root route. Generated parameter names remain distinct at every depth. Preserve arrays for ordinary/association/array lists and dictionaries for dictionary lists by extending JsonApiListResponse.data to an array-or-dictionary union. A single embedded value uses JsonApiResponse. Dictionary keys remain independent from their values' UUIDs. Require nonempty routable keys other than . or .., validate against the Zod key schema and encode keys in links. Deleting a required single field or violating a declared container constraint fails with 422 and leaves storage unchanged.

Bodies are plain JSON attributes, as in the Controller examples. Require JSON content types. Use 400 for malformed JSON, 415 for unsupported content types, 422 for invalid attributes/IDs/query values and 404 for valid but missing resources/ancestors/associations.

Retain scalar equality filters only. Accept one JSON filter parameter, for example `?filter={"make":"Toyota"}` after URL encoding. This preserves numeric/string/boolean/null distinctions without a query dependency. Reject duplicates, unsupported options, undeclared/nonpublic fields and nonscalar values. Validate supplied values against model fields without filling absent defaults.

Keep existing response envelopes and self links. Resource links identify the actual item; list links retain the request's query. Generated-route errors use a Zod-backed errors envelope with status/title/detail. Unexpected/output-validation failures return a generic 500 and never expose unfiltered resource data. Preserve normal Hono custom routes.

## Validation, identity and output

Derive pure input validators from the target model, recursively including embedded values. Create requires ordinary required attributes and applies model defaults/normalisation; PATCH validates supplied attributes without applying absent defaults. Preserve unknown-property policy. Derive request shape validators without object-level checks that need omitted managed fields or current values; do not call .omit() directly on a refined Zod object when the installed Zod rejects that operation.

The user approved a revised validation split: inside the storage transaction, controllers construct the complete candidate, apply the pure full-model validator and persist its parsed result only if valid. This enforces cross-field rules such as end > start on partial updates without a read/validate/write race. Run the containing root model for embedded mutations so ancestor and nested invariants remain valid. Candidate validation failures are 422 and leave all storage unchanged; output projection failures remain 500. Keep ControllerInterface/BaseController nongeneric and do not store a resource model on the instance: obtain the validator from the per-call Collection. Keep ConfigStore/ResourceOperations model-independent. ADR 0012 supersedes ADR 0009's placement of all model input validation in web.

Preserve supported hand-written models which require UUID id but omit audit fields: validate declared model data without presenting undeclared generated audit fields to a strict schema, then preserve the real server-managed metadata. Model parsing must not change managed identity/creation/update values. Ordinary model/default/transform handling must respect ADR 0003's stable stored representation; never persist public output projections.

Create replaces supplied managed metadata and generates it for all new items. Nested PATCH addresses the selected embedded item and preserves creation time. Embedded mutations update affected items and their containing-resource ancestors' timestamps; unaffected siblings retain their values/timestamps. Top-level caller metadata is ignored as in the existing controller contract. Embedded IDs in parent PATCH containers can select retained identities under the rules below.

Container replacement rules:

- A supplied ID matching an existing item in that same array retains the item's identity and creation time. Its attributes are replaced and its update timestamp refreshed.
- An entry without an ID is new and receives generated metadata.
- Duplicate IDs and IDs outside that containing array reject the entire request. Supplied timestamps cannot override managed metadata.
- Omitted items are removed; an empty array clears the array. Removing an embedded container removes its descendants. Apply the same rules recursively to supplied descendant arrays.
- A replacement dictionary replaces all keys. An entry can retain identity by an existing ID from that same dictionary, or by its existing key when no ID is supplied. New entries receive generated identities. Reject duplicate IDs and IDs belonging outside that dictionary. Dictionary keys can change while a supplied existing ID retains identity.
- Replacing a single embedded value preserves the existing identity/creation timestamp, rejects a mismatched supplied ID and replaces its ordinary attributes. A previously absent value is newly created. Optional/nullable absence follows its model schema.

Nested item PATCH remains a shallow update; replacing a container is explicit replacement. All changes must be atomic. A retained embedded entry's omitted optional attributes are removed by replacement; a nested item PATCH preserves its omitted attributes. New creates ignore supplied managed metadata; parent PATCH rejects unrecognised supplied embedded IDs rather than importing another owner's identity.

Extend default output projection through embedded resources, including default password omission. Apply the same policy to root and nested responses. Explicit output policy must also govern embedded-route exposure: hiding an embedded field must not leave another generated route exposing it. Exposed embedded output definitions must preserve container shape and identity sufficiently to route safely; reject incompatible output definitions rather than leaking or returning a mismatched item. Validate the containing resource's output before committing embedded mutations and reuse the projected subtree. Output projection must not mutate storage. Never return raw values after a projection failure. Full candidate validation at commit must preserve declared required/minimum container and cross-field constraints when modifying embedded values.

## Associations and persistence

Provide programmatic association operations through app.associations using Zod-backed resource references:

```ts
await app.associations.link(
  { collection: 'cars', id: carId },
  { collection: 'tags', id: tagId },
)
await app.associations.list({ collection: 'tags', id: tagId })
await app.associations.unlink(
  { collection: 'cars', id: carId },
  { collection: 'tags', id: tagId },
)
```

Link requires registered independent endpoints, an allowed declared association and existing resources. Repeating a link is idempotent. List reports all associations involving the resource, without private resource payloads. Unlink retains both endpoints. This supplies lifecycle operations without adding the deferred HTTP link-existing endpoint.

Persist links in the reserved hedra_associations table using generic JSON records and scalar reference fields. Do not copy associated Resources into parents or add association bookkeeping to their domain attributes.

Embedded changes use the existing atomic containing-record update. Association operations need a generic backend-owned transaction across records: nested creation commits its resource and link together; deletion checks and link creation cannot race into dangling references. A process-only mutex or compensating deletion is insufficient.

Extend Backend/SqliteBackend with this generic transaction contract:

```ts
interface BackendTransaction {
  insert(table: string, record: DatabaseRecord): void
  select(table: string, filter?: DatabaseFilter): DatabaseRecord[]
  update(table: string, id: string, modify: RecordModifier): DatabaseRecord | null
  delete(table: string, id: string): boolean
}

// Addition to the existing asynchronous Backend interface.
transaction<T>(work: (transaction: BackendTransaction) => T): Promise<T>
```

BackendTransaction represents synchronous operations in one backend-owned transaction, not model-aware storage. Preserve the existing asynchronous operations as the normal interface. Reject async/thenable callbacks, roll back their writes, prevent continuations from reusing expired sessions and avoid unhandled rejections. Reuse the same generic JSON/key checks in transaction operations and ordinary operations. SQLite uses an immediate transaction; nested transaction usage must either use safe savepoints or reject without partial state. Preserve table-name validation, parameter binding, rollback and app/backend close guards. Export BackendTransaction alongside Backend. Update injected-backend capability validation and fixtures for the new required operation. ADR 0011 records why multi-record transactions are necessary.

## Responsibilities and dependencies

The Controller work and follow-up ResourceOperations type correction have landed in main (latest committed base inspected: 7590513). Integrate that committed revision before implementation; preserve other chats' uncommitted main edits. Preserve ControllerInterface/BaseController's five CRUD names/argument order, shared-backend construction, output DTOs and HTTP-independent ConfigStore operations.

Request scope in Hono context identifies the target and validated ancestors. The web module registers paths, creates pure validators, installs that scope and shapes HTTP responses. It performs no datastore calls, resource lookups, association traversal or array mutation. Controllers enforce ancestry and choose the operation. Existing custom controller selection remains.

Extend these modules, splitting cohesive helpers only where needed:

- src/models/resource.ts: resource schemas, embedded markers and metadata.
- src/models/collection.ts: embedded definitions and association declarations.
- src/models/rest.ts and an association model file if needed: scope, reference/association and error DTOs.
- src/routes/resources.ts: automatic routes, request validation and HTTP responses/errors.
- src/controllers/controller.ts and focused embedded/association modules: behaviour, traversal, mutation, projection and deletion checks.
- src/datastores/backend.ts and backends/sqlite/sqlite.ts: transactions and storage safeguards.
- src/server/server.ts: registration, ownership and association access.
- src/hedra.ts: deliberate public exports.

Update affected definitions, HTTP/controller/registration/backend tests and fixtures. Reconcile existing examples' explicit routes with automatic generation. Document definitions, routing, replacement identity, associations, unlinking, errors and backend transactions; add an executable hierarchy example without a listener.

## Public test design

The lead accepts package exports/registration, HTTP through app.request, programmatic associations and public Backend transactions against real SQLite as test seams. Use deterministic time. Preserve existing ConfigStore/storage/controller regressions. Avoid private-method tests, internal spies and raw-SQL resource assertions.

| Named behaviour | Public evidence |
| --- | --- |
| registration exposes resource CRUD with the selected controller | Five operations, statuses, output envelopes, Location/self links and a custom controller through app.request. |
| definitions distinguish independent and embedded resources | Extended base schemas; independent root routes, nested-only embedded arrays/dictionaries/singletons, ordinary containers, multi-level definitions, reuse/name/collision failures. |
| request validation prepares data without unintended defaults | Required fields, normalisation/defaults, partial updates, unknown fields, UUIDs, scalar types, duplicate query options, malformed JSON and content types; failures leave public reads unchanged. |
| complete candidate validation enforces model rules atomically | Refined models can be registered; invalid create and partial updates spanning stored fields return 422 without writes. Embedded mutations preserve root/child cross-field rules. Retain nongeneric controllers and strict UUID-only models without declared timestamps. |
| embedded operations remain scoped to every ancestor | Two roots, siblings and multiple depths; a valid ID under the wrong owner and missing ancestors return 404. |
| embedded mutations are atomic and retain metadata | Individual lifecycle, unchanged siblings, deterministic timestamps and file-backed reopen. |
| parent container replacement retains or creates identities | Retained/new/omitted items, empty/nested arrays, dictionaries and singletons, dictionary key selection/renaming, duplicate/foreign IDs and spoofed timestamps; one invalid entry rolls back all. |
| all hierarchy responses apply public output policy | Root/nested single/list/create/update paths, nested secrets, loose schemas and explicit policies; projection errors neither leak nor commit. |
| association traversal returns only linked resources | Links created through app.associations, a shared target, root access, nested lists/items/filters, and wrong/missing ancestors. |
| nested associated creation commits both resource and link | Success through canonical/navigation routes; failed link/projection/storage leaves no partial state. |
| deletion reports blockers and preserves resources | 409 lists every association involving either endpoint, regardless of route; resources and navigation remain available. |
| unlink removes only its association | Programmatic/HTTP unlink preserve endpoints and unrelated links; removed navigation returns 404 while root access works. |
| deleting the owner removes embedded items without deleting associated Resources | Resolve blockers, delete owner and retain independent targets. |
| backend transactions roll back and prevent dangling associations | Commit/throw/invalid outputs, async/expired sessions and competing link/delete through two backends without sleeps. |
| registration and close preserve shared-backend ownership | Failed registration leaves no partial binding; saved controller/association handles close; borrowed backend remains usable. |

## Implementation and acceptance

The user confirmed container-based embedding, key-addressed dictionaries and deletion blocked until every association is removed. The lead accepts the identity-preservation/replacement, singleton, transport and transaction details above as routine design choices supporting those behaviours.

Commit this plan, integrate committed main and delegate implementation to the configured coder. The coder owns production/tests and follows one failing public-behaviour test with the smallest passing change per TDD cycle. The lead owns docs/examples in a separate docs worktree and accepts implementation against the plan. The repository references an unavailable user-docs skill; use the installed docs-style skill and include a newcomer check of all documented examples in the independent review.

Run bun run check and executable examples, then obtain an independent read-only review of the fixed commit range. Fix confirmed issues through the same coder and repeat affected checks/review as appropriate. Ask the user only for the final main merge or a genuinely missing product/scope decision. Do not push or merge main without approval.
