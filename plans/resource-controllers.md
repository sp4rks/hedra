# Resource controllers and model-agnostic storage

Status: design and test design approved in chat. Implementation follows the agreed scope below.

## Agreed direction

- A controller handles operations for one resource type. The default controller is reusable across models, and a collection can select a custom controller.
- Application code uses asynchronous controller methods through `collection.controller`; direct synchronous collection CRUD methods are removed.
- The default controller always generates a fresh UUID on creation and rejects a supplied `id`.
- Mutations address one resource by ID. Listing retains equality filters.
- Database operations are model agnostic: `insert`, `select`, `update`, and `delete`. Backend code knows no Car or Tenant schema.
- Both application collections and tenant configuration use the same backend contract and SQLite implementation.
- A collection name selects a physical SQLite table. Its default endpoint is `/<name>`, recorded as metadata only; HTTP route generation remains deferred.
- No legacy migration is required. Do not add migration code, compatibility methods, or automatic import of old application records.

## Resource models

Add the shared Zod schema `Resource`, containing a required UUID `id`, and its inferred same-name type. Resource-specific stored models extend that schema; example `CarModel` adds its existing car fields and `Tenant` adds its trimmed, nonempty name. The UUID comes from the default controller rather than a schema default or the backend.

Operation input types derive from the supplied model. Create and replacement inputs omit `id`; update accepts partial attributes without `id`. Runtime input validation also rejects an explicitly supplied ID. Resource IDs are immutable. Retain complete-model synchronous refinements, defaults, normalisation, unknown-property policy, stable JSON requirements, and validation of stored data. Model-agnostic JSON validation in storage does not replace resource-model validation in controllers.

## Controller interface

`Controller` is generic over the resource's Zod model and receives the table name, model, and backend. It returns domain resources, with no Hono contexts or HTTP responses.

| Method | Result and behaviour |
| --- | --- |
| `create(input)` | `Promise<Resource>` typed from the model. Generate a UUID, validate the complete resource, insert it, and return the parsed resource. Reject a supplied ID. |
| `get(id)` | `Promise<Resource \| null>`. Validate the identifier and stored resource; return null when absent. |
| `list(filter = {})` | `Promise<Resource[]>`. Validate declared scalar equality filters and every returned resource; preserve insertion order. |
| `update(id, changes)` | `Promise<Resource \| null>`. Shallow-merge attributes into the current resource, preserve its ID, validate the complete result, and return it; return null when absent. Nested objects and arrays are replaced as whole attribute values. |
| `replace(id, input)` | `Promise<Resource \| null>`. Replace the attributes using the complete model and its defaults, retaining the ID; return null when absent. |
| `delete(id)` | `Promise<boolean>`. Remove the addressed resource and report whether it existed. |

Creation rejects invalid inputs before insertion. Updates and replacements either validate and persist one complete resource or leave storage unchanged. Reads do not repair malformed stored data. There is no upsert, bulk mutation, pagination, ordering option, query language, authentication, or tenant isolation in this increment.

## Collection definition and custom controllers

Keep the existing `Collection` export and its source location, but make it a definition binding `name`, `model`, `endpoint`, and controller selection rather than the owner of CRUD implementation.

```ts
const cars = new Collection('cars', CarModel)
const customCars = new Collection('cars', CarModel, CarController)
```

The optional third argument is a controller class with the same construction contract as `Controller`; omission selects the generic controller. Preserve the concrete controller type on `collection.controller` so custom operations remain typed.

Registration supplies the backend and constructs the selected controller. Accessing `collection.controller` before registration throws. `Hedra.register` stays synchronous and retains duplicate-name/reuse checks and registration logging. A closed app ends access through its registered controllers, including saved controller references. The collection's endpoint defaults to `/<name>` but registration adds no HTTP routes.

## Generic backend contract

Define the shared `Backend` interface in `src/datastores/backend.ts`. Its data shapes describe storage: a JSON-compatible object with a string primary-key ID, and dictionaries of scalar equality criteria. They contain no resource-specific schemas. Derive data types from the generic storage schemas.

```ts
interface Backend {
  insert(table: string, record: DatabaseRecord): Promise<void>
  select(table: string, filter?: DatabaseFilter): Promise<DatabaseRecord[]>
  update(table: string, id: string, modify: RecordModifier): Promise<DatabaseRecord | null>
  delete(table: string, id: string): Promise<boolean>
}
```

`RecordModifier` is a synchronous function from one `DatabaseRecord` to another. The controller supplies validation and merging inside that function. `update` loads the current resource, invokes the function, and persists the result inside one transaction, returning null without invoking the modifier when the ID is absent. Invalid JSON, a changed primary key, callback failures, and storage failures abort the write. This keeps read/validate/write atomic without adding a public transaction abstraction or putting model rules in the backend.

`insert` rejects an existing primary key without replacing it. Backend selection and mutation are scoped to the supplied table. Validate table identifiers at the backend before interpolating quoted SQL identifiers, and bind record data, IDs, and filter values as parameters. Generic storage-boundary validation is independent of resource-model validation.

The SQLite backend opens one Bun SQLite database and creates each requested table lazily with `id TEXT PRIMARY KEY NOT NULL` and `data TEXT NOT NULL`. Resource data remains JSON; no model-dependent SQL columns or ORM are introduced. It supports in-memory databases and creation of missing parent directories. Remove the older application-only SQLite module after its callers move to this backend.

## Wiring and connection ownership

`new Hedra()` retains a lazy, app-owned SQLite backend using its existing `sqlitePath` setting. Add an optional `backend` in `HedraOptions` so a caller can share an existing backend with application collections and configuration:

```ts
const backend = new SqliteBackend(':memory:')
const config = new ConfigStore(backend)
const app = new Hedra({ backend })
const cars = new Collection('cars', CarModel)

app.register(cars)
const car = await cars.controller.create({ make: 'Toyota', model: 'Corolla', year: 2024 })
```

`Hedra.close()` ends its controllers' lifecycle and closes only its app-owned default backend. An injected backend is borrowed and stays open for other users such as `ConfigStore`; its creator closes it after all users finish. Existing bootstrap `Config` behaviour remains unchanged. `Backend` defines resource operations, while concrete backends retain their own connection lifecycle methods.

`ConfigStore(backend)` defines and immediately binds its tenant collection, exposing the generic controller as `config.tenants`. Use the existing framework table name `hedra_config_tenants` as that collection's storage name. `config.tenants.create({ name: 'Acme' })` now returns a generated UUID and name, and the controller provides the other resource operations. Remove the tenant-specific `ConfigBackend` interface and `insertTenant` implementation.

## Structure and exports

```text
src/
  controllers/controller.ts          Resource operations and model validation.
  datastores/backend.ts              Generic storage contract and storage data shapes.
  datastores/backends/sqlite/sqlite.ts
  datastores/categories/config/config.ts
  models/resource.ts                 Shared resource metadata schema and inferred type.
  models/tenant.ts
  models/collection.ts               Collection definition and registration binding.
  server/server.ts                  Backend injection, registration, and ownership.
  hedra.ts                          Deliberate public exports.
```

Remove `src/datastores/sqlite.ts`. Export `Resource`, `Controller`, and `Backend` alongside the existing relevant public exports; remove `ConfigBackend`. Update the examples, callers, and documentation to use async controller operations and generated resource IDs. Preserve independent construction of controllers without an HTTP server. Use no new dependency or cloud runtime API.

## Test design

Test through the deliberate exports from `src/hedra.ts`, with real in-memory or temporary file-backed SQLite databases. Each test uses one failing behaviour followed by the minimum implementation before the next behaviour. Do not mock controllers, assert SQL text or private fields, or query storage tables to confirm resource operations that can be observed through the public interfaces.

| Public seam | What it catches | Limits |
| --- | --- | --- |
| Independently constructed `Controller` and its resource operations | Identity, input and stored-data validation, typed results, CRUD semantics, and unchanged data after failures. | Does not prove app registration or connection ownership. |
| `SqliteBackend` constructor, generic operations, and `close` | Model-agnostic storage, literal filters and identifiers, table isolation, duplicate protection, transactions, persistence, and native failures. | Does not enforce resource-specific model rules. |
| `Collection`, `Hedra.register`, `HedraOptions`, and `Hedra.close` | Controller selection, metadata, ownership and lifecycle, and the absence of generated HTTP routes. | Does not test a future Web layer. |
| `ConfigStore.tenants` sharing a backend with app controllers | Tenant-model wiring and reuse of the generic controller and backend. | Reuses controller coverage rather than repeating every CRUD case. |
| SQLite file-format contract through an independent read-only SQLite connection | The explicitly requested physical table names and generic column layout. Inspect metadata only in this contract test. | Resource contents are still verified through controller/backend operations, not through SQL side channels. |

### Controller behaviours

Use `tests/controllers/controller.test.ts` for the resource operations, porting applicable existing collection tests rather than maintaining two suites for the same behaviour.

| Named test | Expected behaviour |
| --- | --- |
| `create returns a normalized resource with a fresh UUID` | Create two resources, validate their UUIDs, require distinct IDs, and retrieve the literal expected attributes. Model defaults and normalisation are reflected in stored and returned resources. |
| `create rejects a supplied ID without inserting a resource` | Reject supplied IDs, including a valid UUID, before writing. A subsequent list remains empty. |
| `create rejects invalid resource attributes without writing` | Cover missing and incorrectly typed fields and a complete-model refinement. No failed resource appears in a subsequent list. |
| `get returns one resource or null` | Retrieve exactly the addressed resource; a valid absent ID returns null. |
| `list returns matching resources in insertion order` | Match every supplied scalar field, support empty/default filters, and return an empty array for no matches. |
| `resource operations reject invalid IDs and filters without changing data` | Cover malformed IDs, undeclared filter fields, invalid field values, symbol keys, and unsupported nested filter values. |
| `update changes only the addressed resource and preserves its ID` | Shallow-merge attributes, preserve unspecified fields, replace nested objects/arrays as whole values, and support an empty changes object. Another resource stays unchanged. |
| `replace uses the complete model while preserving the addressed ID` | Replace attributes, discard omitted optional attributes, apply defaults, and leave other resources unchanged. |
| `mutations reject an ID in their input and preserve stored resources` | Update and replacement payloads cannot supply even the existing ID. |
| `invalid updates and replacements leave the resource unchanged` | Reject type errors and cross-field refinement failures; compare the complete resource before and after through get. |
| `update and replace return null without inserting missing resources` | A valid absent ID returns null and no resource is created. |
| `delete removes only the addressed resource and reports absence` | Return true on deletion and false when absent; another resource remains retrievable. |

Retain the existing meaningful coverage for model unknown-property policy; scalar type and null distinctions; literal punctuation in filter names and values; non-JSON values; unstable or mutating model transformations; validation of persisted resources through the current model; rejection of asynchronous model refinements; and native write failures leaving data unchanged. Adapt those tests to the async controller interface and generated IDs. Use a second controller with a stricter model, or public backend insertion of generically valid but model-invalid data, to exercise stored-data validation. Retire the old filter-based bulk mutation expectations, which the user explicitly replaced with single-resource operations.

Compiler checks must retain model-specific input/result types and reject caller IDs in mutation inputs. Include a custom controller method in an actual registration test so its inferred type is exercised without a separate speculative typing framework.

### Generic SQLite behaviours

Use `tests/datastores/backends/sqlite/sqlite.test.ts` for the public persistence interface. Fixtures include arbitrary JSON resource shapes and a non-UUID string primary key, demonstrating that SQLite does not enforce Car, Tenant, or controller-specific UUID rules.

| Named test | Expected behaviour |
| --- | --- |
| `SqliteBackend stores arbitrary JSON records by table` | Insert and select different record shapes through the same backend. Table-specific records remain separate, including equal primary keys in different tables. |
| `SqliteBackend rejects duplicate primary keys without replacing data` | A duplicate insert rejects; select returns the original literal record. |
| `SqliteBackend treats IDs and filter values as literal data` | SQL punctuation in data cannot alter selection or storage. Preserve scalar types and null semantics. |
| `SqliteBackend rejects invalid table identifiers without affecting other tables` | Invalid identifier strings and non-string inputs fail safely across operations. A valid quoted name containing a permitted hyphen works. |
| `SqliteBackend rejects non-JSON records without writing` | Invalid inputs and invalid modifier outputs leave stored data unchanged. |
| `SqliteBackend applies an update modifier atomically` | Return the modified record. A throwing modifier, a changed primary key, or a failed write rolls back; select still returns the prior record. A missing ID returns null without invoking the modifier. |
| `SqliteBackend holds its transaction while the modifier runs` | Use two public backend instances on the same temporary file to attempt a competing write inside a modifier. The competing operation may serialize safely or reject, but successful changes cannot be silently overwritten. Check stored results against successful operations, keep rejection handlers attached, and use no timing-based sleeps. |
| `SqliteBackend persists records across reopening a nested path` | Close and reopen, then select the exact stored record. This also exercises parent-directory creation. |
| `SqliteBackend gives in-memory instances independent storage` | One instance's records are absent from another. |
| `SqliteBackend rejects an unusable path and access after close` | A directory path fails at construction; operations reject once the shared backend is closed. |
| `SqliteBackend creates the requested physical tables` | After public operations, an independent read-only SQLite metadata query observes the collection's literal table name and generic id/data columns. Do not inspect record contents through this connection. |

### Registration and configuration behaviours

Keep constructor/metadata tests in `tests/models/collection.test.ts`; adapt the existing server registration, options, lifecycle, and example tests where those behaviours already live. Update `tests/datastores/categories/config/config.test.ts` for configuration integration.

| Named test | Expected behaviour |
| --- | --- |
| `Collection binds resource metadata and rejects invalid definitions` | Preserve name/model validation and expose the selected name, model, and default endpoint. The model must satisfy the resource definition. Accessing the controller before registration throws. |
| `registration constructs the default controller with the collection's model and table` | Create and retrieve a resource through `collection.controller`; another collection is isolated. |
| `registration preserves a custom controller and its additional operations` | Supply a subclass as the third constructor argument, use its extra method, and observe its resource behaviour through the public controller. |
| `registration retains duplicate-name and instance-reuse checks` | Duplicate registration and reusing one collection across apps fail without changing registered resources. |
| `Hedra lazily owns its default SQLite backend` | No database file is opened before registration. Closing the app ends its controller access and preserves file-backed resources for a new app. |
| `Hedra rejects malformed injected backends before registration` | Missing/non-function backend capabilities reject through options validation. Existing configuration and logger validation guarantees remain intact. |
| `Hedra.close invalidates saved controller references without closing a borrowed backend` | A shared injected backend remains usable by another app and ConfigStore; every controller registered to the closed app rejects further operations. Close stays idempotent. |
| `failed registration leaves a collection available for a later successful registration` | Retain the existing failed-open recovery behaviour, with no partially bound controller. |
| `collection registration records endpoint metadata without adding HTTP routes` | Default endpoint is /cars, while requests to it still receive 404. Existing explicitly registered Hono routes keep working. |
| `ConfigStore exposes tenant resource operations through the generic controller` | Create with only a name, receive a UUID and normalised name, then get/update/replace/delete through tenants. Invalid tenant names reject without insertion. |
| `ConfigStore instances share tenant storage and remain separate from app resources` | Stores sharing one backend see the same tenants; application resources stay in their own tables. |
| `closing a shared backend ends access for every store using it` | Both config and app controller operations reject after the caller closes their backend. |

Update the model/example smoke test and configuration-store example for async calls and generated IDs. Run `bun run check` after code and docs are combined, run the documented standalone examples without starting a web server, and give the fixed commit range and check results to the independent reviewer. HTTP route implementation, migration, other backends, bulk operations, authentication, and performance/load benchmarks remain excluded.

## Decisions and next stage

ADR 0007 supersedes ADR 0001's placement of CRUD on collections and ADR 0006's placement of validation on category classes. It preserves backend connection ownership. ADR 0003's stored-model contract remains in force.

After test-design approval, commit the agreed plan and delegate implementation to the global coder with TDD, while docs are written in a separate docs worktree. Run required checks and examples, obtain independent read-only review, and request approval before merging to main.
