# Model-driven collection CRUD

Status: behaviour, concrete design, documentation fallback and test design approved. Implementation is authorised.

## Agreed intent

- Models are the primary way consuming applications define their own data in Hedra.
- A model is a Zod schema, providing runtime validation and an inferred TypeScript type.
- A consuming application associates a model with a collection and registers the collection with Hedra.
- The eventual application interface is model-driven CRUD over HTTP. In this feature, collection CRUD methods are implemented first; controllers will expose the HTTP API in a later step.
- `examples/02-models.ts` must demonstrate the resulting public interface.
- Collections persist to SQLite through Bun's built-in driver, keeping records across restarts.
- The collection interface is `new Collection('cars', CarModel)`, followed by `hedra.register(cars)`.
- Record IDs are deferred to the subsequent controller work. This feature must not introduce framework-managed record IDs.
- The first feature is single-tenant. Tenant isolation and authorization are deferred. No collection HTTP routes are introduced in this step.
- Models in this feature are Zod object schemas containing JSON-compatible data, including nested objects and arrays.
- Methods select records with equality filters on top-level string, number, boolean or null fields. All supplied fields must match. Reads return all matches; updates and deletes affect all matches and require a nonempty filter.
- Write operations follow REST semantics: POST creates a record, PUT replaces the full record, and PATCH changes selected fields and validates the complete result. Controllers will later map these operations to HTTP methods.
- Hedra owns one SQLite database shared by its registered collections. `HEDRA_SQLITE_PATH` configures its location, defaulting to `.runtime/hedra.sqlite`. Collections have no individual storage configuration; container deployments persist the database directory through a volume.
- Models describe the persisted shape. Parsed records must remain valid and stable when read through the same schema. Validation, defaults and string trimming fit this contract; incompatible input/output conversions belong in separate controller input schemas later.
- Collection methods are synchronous: `post` returns the stored record; `get` returns matching records; `put`, `patch` and `delete` return the number of matching records written or deleted. No matches returns `[]` or `0`; PUT does not create missing records. Validation and storage failures throw.
- PATCH merges top-level fields. A supplied nested object or array replaces that value as a whole; null remains a schema-governed value.
- PUT and PATCH validate every resulting record before committing. If any result fails, the operation changes no records.
- Registration attaches a collection to Hedra's database, which opens on first registration. Methods fail before registration. Duplicate collection names and attaching one collection instance to multiple apps are rejected. `hedra.close()` releases the connection.
- Use `/home/sparks/projects/zArchive/round2/hailmary/multi21` as a reference when design questions arise, while preserving the decisions agreed for Hedra.

## Public interface

The package entry point exports `Hedra` and the new `Collection` class. Existing Hono routing, configuration, logging and listen behaviour remain supported.

The model example retains its business fields and uses the same name for its schema and inferred type:

```ts
import { z } from 'zod'

import { Collection, Hedra } from '#hedra.ts'

const CarModel = z.object({
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
})
type CarModel = z.infer<typeof CarModel>

const cars = new Collection('cars', CarModel)
const hedra = new Hedra()
hedra.register(cars)

export { CarModel, cars }
export default hedra
```

The example exports its collection so callers and verification can exercise its methods. Importing the example does not seed or modify records.

| Method | Behaviour | Result |
| --- | --- | --- |
| `collection.post(record)` | Parse and insert one full record. | The parsed stored record. |
| `collection.get(filter?)` | Read all matching records; an omitted or empty filter reads the collection. | An array in insertion order, including duplicate records. |
| `collection.put(filter, record)` | Replace every match with the parsed full record. Omitted fields follow the full model's defaults and optionality. | Number of records replaced, or zero. |
| `collection.patch(filter, changes)` | Shallow-merge changes into each match and parse every complete result. | Number of matching records updated, or zero. |
| `collection.delete(filter)` | Delete every matching record. | Number of records deleted, or zero. |
| `hedra.register(collection)` | Attach a previously unattached collection to this app. | `void`. |
| `hedra.close()` | Release SQLite resources and end the collection lifecycle for this app. | `void`; repeated calls are harmless. |

Method input and result types derive from the associated Zod schema. PATCH input is a partial model input. Filters use the model's declared scalar fields and their stored types; all calls still validate runtime inputs.

Collection names must start with a lower-case letter and contain only lower-case letters, digits, underscores or hyphens. Names are literal resource names, with no automatic pluralisation or case conversion.

### Filters and writes

- A filter is an object containing declared top-level model fields with finite-number, string, boolean or null values. Every field must match. Reject unknown field names, unsupported values and non-object filters before querying.
- Boolean, numeric and string equality remain distinct. Null matches an explicit null field and does not match an absent field. Field names containing punctuation are literal field names.
- PUT, PATCH and DELETE reject missing or empty filters. GET permits them.
- PUT is full replacement. PATCH accepts a JSON object and merges only the fields supplied. An empty PATCH object is a valid no-op that reports the number of matches.
- Validate PATCH results with the original model, preserving cross-field refinements. Do not derive its runtime validator with `model.partial()`, which Zod rejects for refined object models.
- Select matches, validate and serialize replacement records, then write within one immediate SQLite transaction. A validation or storage failure rolls back the entire operation. DELETE is a single atomic statement.
- There is no uniqueness convention, sorting option, pagination, comparison-operator query language or automatic upsert in this feature. GET reads every match in insertion order.

### Model validation and JSON

- Models are synchronous Zod object schemas. The model controls required fields, defaults, refinements, normalisation and unknown-field handling.
- Parse full POST and PUT inputs and each merged PATCH result through the associated model. GET and PATCH also validate matched stored records before using them.
- Parse persisted values through a JSON-compatible-value schema and actually serialize them before a write. Explicit undefined values, non-finite numbers, special object types and cycles are rejected without mutating storage. Omitted optional fields are supported.
- Reparse serialized model output to check the stored-model contract: parsing again must produce an equivalent record. Reject models whose transforms change or invalidate their output on a round trip.
- Reads apply the current model without updating storage. Invalid stored records fail validation; this feature performs no automatic schema migration or repair.
- Zod validation failures and native filesystem/SQLite failures remain errors for the consuming application or future controllers to handle. Lifecycle and JSON-contract failures use descriptive errors; add no new public error hierarchy.

## Storage and lifecycle

Use one internal `hedra_records` table with collection-name and JSON-document columns, plus an index on collection name. Bind collection names, filter keys and values as parameters. Use JSON type-aware comparisons for filters rather than interpolating SQL identifiers or JSON paths.

SQLite's implicit row locations may address selected rows inside a transaction. They are never exposed as model fields, identifiers or method results. Controllers remain responsible for the later record-ID design.

The default database path is relative to the application's working directory. Registration creates its parent directory when necessary. Allow SQLite's `:memory:` path for explicitly isolated applications and tests. No database is opened merely by constructing a Hedra app.

`hedra.close()` is terminal for its collection registration: attached collection methods and further registrations throw after closure. Closing before the first registration is harmless and also ends that app's collection lifecycle. Closing never deletes the database file.

Use Bun's native synchronous database and transaction APIs directly. This feature has one storage implementation and introduces no datastore interface, adapter framework, ORM or dependency. It retains SQLite's ordinary connection locking and surfaces storage failures rather than adding retries or background work.

## Files and responsibilities

```text
src/
  models/collection.ts                  Collection construction, model validation and CRUD methods.
  datastores/sqlite.ts                  Native SQLite opening, shared table and bound record queries.
  server/server.ts                     Registration, shared connection ownership and close.
  server/config/categories/server.ts   HEDRA_SQLITE_PATH in the existing config mechanism.
  hedra.ts                             Deliberate Collection and Hedra package exports.
tests/
  models/collection.test.ts            Behaviour through exported Collection methods.
  server/hedra.test.ts                  Registration and lifecycle through Hedra.
  server/config/config.test.ts         Database configuration through loaded config.
  models-example.test.ts               The actual model example through its named exports.
docs/
  collections.md                       Public method, schema, filtering and persistence reference.
examples/
  02-models.ts                          Model, type, collection and registration example.
```

The collection and SQLite modules contain the implementation behind the small public collection interface. Keep internal binding and storage helpers out of `src/hedra.ts`. Extend the existing configuration category rather than adding a configuration framework.

The plan, glossary and ADRs are also part of the feature. No package dependency, alias or runtime migration is required. The Bun process and container deployment model stay intact.

## Acceptance criteria

- The real model example typechecks, registers its collection and supports the full method lifecycle against an isolated SQLite database.
- Model validation and inferred input/output types govern CRUD; nested JSON, defaults, string trimming and root refinements work under the stored-shape contract.
- Scalar filters select exactly the intended records without exposing internal SQLite row locations.
- Full replacement, shallow partial updates, no-match results and atomic failure behaviour follow the agreed contracts.
- Different collections remain separate; closing and reopening the same file retains their records.
- Invalid registration, lifecycle, filter, JSON and model inputs fail clearly and leave existing data intact.
- Existing supported Hedra behaviour continues to pass `bun run check` in the feature worktree.
- Documentation explains the single-tenant scope, methods, filter cardinality, close lifecycle and persistent container volume, and its examples run against the implementation.

## Documentation and delivery

The project's named `user-docs` skill is absent from the repository, global skill roots and installed plugin cache. Approved replacement: follow the available `docs-style` skill and house Diataxis guidance, and have the independent reviewer assess the docs and example from a newcomer's perspective.

After test-design approval, commit the plan and agreed documentation records, hand implementation to the configured coder in this worktree, and write user docs and the example on a separate `feature/models-crud-docs` worktree touching only `docs/` and `examples/`.

Merge docs into the feature branch, run `bun run check` and the documented examples, and obtain one independent read-only review using the configured reviewer. The coder addresses confirmed findings and reruns affected checks. Request approval before merging the reviewed feature into `main`, as the project requires.

## Approved test design

### Public seams

| Seam | What it catches | What it does not cover |
| --- | --- | --- |
| `Collection` methods imported from the package entry point, attached through `Hedra.register` | Model validation, filters, CRUD, atomicity, collection separation and persistence against real SQLite. | Private helpers, SQL shape, query plans, performance under load or multiple deployment processes. |
| `Hedra.register`, `Hedra.close` and existing Hono request handling | Registration failures, lazy connection ownership, resource cleanup and the absence of generated collection routes. | New HTTP controllers, authentication or tenant isolation, all of which are deferred. |
| The existing `loadServerConfig` seam | SQLite path defaults, explicit overrides and existing environment-file precedence. | New tests of unrelated settings or general filesystem behaviour. |
| The actual model example's named exports in an isolated Bun process | The documented consumer interface, schema/type exports, working collection methods and clean shutdown. | A real HTTP collection API or mutation of the main checkout's default database. |

Use real temporary SQLite files for persistence and native failure cases, and explicitly configured `:memory:` databases for isolated method cases. Close every app and remove each temporary directory. Verify stored data only through collection methods, never by querying private tables or inspecting internal fields. A competing native SQLite connection may hold a file-level write lock to exercise a real storage failure without depending on the internal table layout.

### Collection method behaviours

These tests live in `tests/models/collection.test.ts`. Closely related invalid values may use table-driven cases instead of separate test bodies.

| Test name | Coverage |
| --- | --- |
| `POST stores and returns the parsed model` | Required car fields, inferred output, trimming, defaults, nested objects/arrays, and no generated metadata. |
| `POST follows the model's unknown-field policy` | Default stripping, strict rejection and explicitly permitted extra data are governed by Zod. |
| `POST rejects invalid model data without inserting a record` | Missing required fields, invalid types and integer/refinement failures; GET remains unchanged. |
| `GET returns every match in insertion order` | Omitted and empty read filters, duplicate records and an empty collection. |
| `GET requires every supplied filter field to match` | Conjunctive equality and no-match results. |
| `Filters preserve scalar types and explicit null` | String versus number, boolean versus number, finite numeric equality and null versus an absent optional field. |
| `Filters treat field names and values as literal data` | Declared dotted/quoted keys and injection-looking values do not change selection. |
| `Invalid filters fail without changing records` | Unknown fields, arrays, nested objects, undefined and non-finite values; malformed filter objects; missing/empty filters on PUT/PATCH/DELETE. |
| `PUT replaces every match with the full parsed model` | Matched counts, removal of omitted optional fields, defaults, duplicate results and preservation of nonmatches. |
| `PATCH preserves fields that were not supplied` | Top-level partial changes, existing nondefault values, full-model validation and a valid empty patch. |
| `PATCH replaces nested values and preserves allowed nulls` | Whole-object/array replacement, no recursive merge and schema-controlled null values. |
| `PUT and PATCH return zero when no records match` | No automatic creation; valid no-match DELETE also returns zero. |
| `Invalid PUT leaves every matched record unchanged` | An invalid full replacement cannot cause a partial write. |
| `PATCH rolls back every match when a later result fails validation` | Two records selected together; a cross-field refinement accepts the first merged result and rejects the second; neither record changes. |
| `DELETE removes every match and reports the count` | Matching duplicates, preserved nonmatches and an empty subsequent read. |
| `Collections keep their records separate` | Identical model fields in different collections do not leak through reads, replacements, patches or deletes. |
| `Non-JSON model output is rejected before persistence` | Explicit undefined, non-finite numbers, bigint, special objects and cycles; omitted optional fields remain supported. |
| `Unstable model transformations are rejected before persistence` | Type-changing output that cannot be reparsed, and same-type output that changes again on a round trip; stable normalisation remains supported. |
| `Synchronous methods reject asynchronous model validation` | An async refinement throws and leaves the collection unchanged. |
| `GET validates persisted records against the current model` | Write using a valid earlier schema, close, reopen with an incompatible model and observe validation failure through GET. |
| `Native write failures preserve existing records` | A competing file-level SQLite write lock causes an error; releasing it reveals the unchanged records through GET. |

### Registration and lifecycle behaviours

These tests extend `tests/server/hedra.test.ts`, with data assertions through the collection interface.

| Test name | Coverage |
| --- | --- |
| `Collection methods fail before registration` | All five methods reject an unattached collection. |
| `Collection rejects an invalid name or a non-object model` | Constructor contracts, while accepting refined Zod object models. |
| `Register rejects duplicate names and collection reuse across apps` | Rejected registration does not damage the original attachment or its records. |
| `Hedra opens SQLite only when the first collection is registered` | Construction succeeds with an unusable database location; registration surfaces the native failure. |
| `A failed database open leaves the collection available for registration` | Attach the same collection to another app with a usable path after the failed attempt. |
| `Close is idempotent and ends the app's collection lifecycle` | Attached methods and further registrations fail after close, including close before first registration. |
| `Reopening a database preserves registered collection records` | A new app and collection instance read the exact persisted records, including nested JSON, after clean closure. |
| `Registering a collection adds no HTTP routes` | Hono requests to the collection path still return 404; existing route behaviour stays covered by the existing suite. |

### Configuration and consumer example

Extend existing configuration tests instead of retesting the shared loader for unrelated settings:

- `SQLite path uses the default when unset or blank`: `.runtime/hedra.sqlite` is loaded without opening a database.
- `SQLite path uses a trimmed explicit override`: the chosen path, including `:memory:`, reaches Hedra's loaded configuration.
- Extend environment-file precedence coverage with `HEDRA_SQLITE_PATH`, including an explicit value winning over the file.

Add `models example supports the full collection method lifecycle` in `tests/models-example.test.ts`: run the actual example as an imported module in a child Bun process with silent logs and an isolated database path. Verify initially empty storage, POST, filtered GET, full PUT, partial PATCH, DELETE and `hedra.close()`. The process must exit cleanly without starting a collection HTTP server.

`bun run check` also verifies schema-derived types at ordinary consumer/test call sites and compiles the actual example. Type errors expected for invalid typed inputs should be checked alongside their runtime rejection cases rather than by introducing a separate type-test framework.

### Execution and limits

The coder works vertically: one failing behaviour test, observe the intended failure, then the smallest implementation that passes; repeat. No production implementation is written before its first relevant failing test, and no tests are added at private seams.

After source and docs are combined, run `bun run check` and the documented CRUD snippets against an isolated SQLite file. Recheck the integrated feature after confirmed review fixes. No benchmark, multi-process stress test, schema migration, HTTP CRUD, tenant or authorization test is included in this feature.

## Existing behaviour

The example declares a car schema with string `make` and `model` fields and an integer `year`.
It exports an inferred type and a bare Hedra application, but never uses the schema at runtime.
Hedra currently supplies Hono routing, configuration, logging and a listen address.
There is no collection, datastore or generated CRUD implementation.

## Reference findings

The local multi21 reference assigns generated IDs and timestamps to its
[base controller](/home/sparks/projects/zArchive/round2/hailmary/multi21/src/controllers/base-controller.ts).
Its [collection](/home/sparks/projects/zArchive/round2/hailmary/multi21/src/server/collection.ts) holds configuration,
while the [datastore](/home/sparks/projects/zArchive/round2/hailmary/multi21/src/datastores/tenant/mongodb/operations/generic-ops.ts)
implements CRUD with MongoDB IDs. Its list operation supports field filters, but individual reads, updates and deletes require IDs.
It therefore informs the controller boundary but does not resolve record selection for this feature.
Its MongoDB, Deno, generated HTTP routes and tenant wiring are not part of the agreed Bun and SQLite collection-method scope.

## Working boundaries

The design notes live on `feature/models-crud` in `.worktrees/models-crud`.
The main checkout contains existing changes to `src/server/server.ts` and untracked model and validator examples.
Those changes remain in place while the design is discussed.

The project instructions reference a `README.md` that is absent; `IDEA.md` contains the available design goals.
There are no existing ADRs or glossary in the starting revision.
