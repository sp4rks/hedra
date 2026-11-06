# REST controller contract

Status: implementation authorized by the user. The lead owns test design and acceptance; the user approves only the final merge.

## Agreed contract

Replace the resource-parameterized controller with the independent `ControllerInterface` and `BaseController` from the supplied reference. Neither is generic or inherits from a resource/model type. The same implementation must work for Car and other resource types; do not add a production CarController.

Keep these public operations and argument order:

```ts
interface ControllerInterface {
  create(context: Context, collection: Collection, input: ResourceInput): Promise<JsonApiResponse>
  id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse>
  list(context: Context, collection: Collection, baseUrl: string, queryParams?: QueryParams): Promise<JsonApiListResponse>
  update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse>
  delete(context: Context, collection: Collection, id: string): Promise<void>
}
```

`Context` is Hono's context, passed per call. `ResourceInput` is a plain, Zod-derived JSON attribute dictionary that does not require generated metadata. This is the input-type adjustment to the original `Resource` parameter: validated create/update bodies must be accepted without supplying server-owned fields. Use no class-level resource/schema generic.

`BaseController` receives the existing shared `Backend` through its constructor. It keeps no collection, table name, resource model or resource type on the instance; the supplied collection chooses storage and output policy on each call. Use the existing generic backend operations directly instead of importing Mongo-specific operations or creating a new connection in the controller.

## Input and resource metadata

Follow the reference by stripping caller-supplied `id`, `createdAt` and `updatedAt` from create/update bodies. Create assigns a fresh UUID and one current ISO timestamp for both audit fields. Update uses its explicit path ID, preserves the stored creation timestamp and ID, and replaces `updatedAt` with the current timestamp inside its atomic mutation. Other attributes, including name and description when supplied, pass through normally. Do not introduce undefined name/description properties on Car data.

Extend the common `Resource` model with the controlled timestamps. Keep name and description resource-specific rather than making them mandatory on every Car. Field-level/domain input validation remains a pure model-derived validator called by the Web layer or caller; the controller performs its explicit managed-field handling and generic structural/JSON safeguards.

## Public output and response types

Add `collection.outputValidator`, defaulting to the model's declared public fields with a top-level password field omitted when present. Use a whitelist/strip projection so omitted sensitive fields cannot reappear through a loose/catchall model. Allow an explicit output validator in collection options for additional public-field policy. Derive the default field projection without carrying object-level refinements that require omitted private fields; callers can provide an explicit output validator when they need output refinements.

Apply output filtering unconditionally to create, id and update results and to every item in list results. Return the projected data in the response envelope and keep stored data intact. Do not copy the reference's destructuring-default bug: a default expression on `data` does not execute when normal data is present. Output validation failures must throw instead of returning raw/unfiltered data.

Define Zod-backed `JsonApiResponse` and `JsonApiListResponse` for the reference's flat resource `data` envelope and self links. No redesign into a different JSON:API document format. Keep error handling through existing thrown errors; resource-not-found on id/update/delete throws the existing 404 error rather than returning the previous programmatic null/false result. Delete resolves without a data result. Transport response status/header handling stays outside these methods.

Keep `QueryParams` limited to existing scalar equality filters. Do not implement pagination, sorting or additional operators, and do not silently ignore unsupported query options. `baseUrl` supplies the list's self link; resource self links use the Hono request URL and addressed/generated ID as appropriate, avoiding malformed links when a create URL has a trailing slash or query string.

## Collection and backend ownership

`new Collection('cars', CarModel)` still selects the default generic BaseController, with endpoint metadata /cars and a physical cars table. Keep the resource model on Collection only. An optional collection options object selects an alternate controller class and/or output validator. Preserve exact custom controller typing, but it is independent of the collection's model type. The controller construction contract is `(backend)`.

Registration constructs/binds the REST controller as before; it adds no HTTP routes. A saved controller from a closed app must still be unable to access storage, while a borrowed backend remains open for other users. Preserve existing name validation, internal tenant-table reservation and owned/borrowed backend semantics. No backend API or physical-table redesign is required.

## Programmatic configuration operations

The user explicitly chose to keep ConfigStore independent of HTTP. Move the existing plain-data CRUD helper out of the controller module into `src/datastores/resource-operations.ts` as `ResourceOperations<T>`. It may be typed by plain resource data because it is a programmatic data helper, not a REST controller. It accepts the table name and backend, never a resource schema or Hono context.

Preserve ConfigStore.tenants' create/get/list/update/replace/delete style and null/boolean missing-resource results. Reuse the helper rather than duplicating six methods inside ConfigStore. Its common managed-field checks and generation must account for the common timestamps, and its callers continue to prepare data with pure validators. Retain existing JSON, key-integrity, transaction and lifecycle safeguards. Keep the tenant table name defined through its internal collection and preserve the reserved-name rule.

No compatibility alias should keep the old generic type named Controller. Public exports become ControllerInterface and BaseController plus the programmatic helper and required DTO/schema types. Update all callers and examples.

## Public tests owned by the lead

Test the REST methods through explicit Hono test routes and app.request so real contexts are supplied; this does not add automatic production routes. Use real SQLite backends and the package exports. Programmatic tests use ConfigStore/ResourceOperations without Hono.

| Named behaviour | Public evidence |
| --- | --- |
| `BaseController implements the REST contract across collections` | One non-generic instance serves Car and another resource using each call's collection/table. Compiler checks reject schema/resource class generics and exercise the reference argument order. |
| `create replaces client metadata and preserves ordinary attributes` | Spoofed ID/timestamps are ignored; stored metadata contains a fresh UUID and controlled ISO timestamps. A Car with no name/description persists without inserted undefined attributes. |
| `update preserves identity and creation time while refreshing update time` | The path ID selects one resource; spoofed controlled fields cannot change it. Only supplied ordinary attributes change. Use deterministic mocked time rather than sleeps. |
| `all resource responses project public output` | Create, id, update and each list item omit private fields, including the default password field and a custom output whitelist. Include a loose/catchall model to prevent passthrough leaks. Public backend reads prove private data remains stored. |
| `output validator failures never return unfiltered resources` | A projection failure propagates as an error on single/list paths; no raw private response is produced. |
| `REST lookup and mutation use expected absence behaviour` | id/update/delete of an absent UUID throw the existing 404 error; delete succeeds with no result and removes only its addressed resource. |
| `list retains equality filters and correct response links` | Scalar type/null/literal-key behaviour remains; unsupported query options reject. Self links are valid for supplied base URLs and create URLs with trailing slash/query strings. |
| `registration retains controller selection and backend ownership` | Default Car needs no custom controller, custom interface implementations remain selectable, invalid/reused definitions reject, and closing one app invalidates saved controllers without closing a borrowed backend. |
| `ConfigStore remains programmatic and shares generic storage` | No Hono context is needed; the existing data helper lifecycle, validation composition, tenant-table isolation and native backend regressions remain meaningful. |

Update existing operation tests to their new layer instead of deleting data-integrity regressions or duplicating the same suite. Keep the SQLite backend tests unchanged unless a confirmed regression requires a focused fix. Run bun run check and executable docs/examples, then obtain independent read-only review. Merge main only after the user's approval.

## Scope and decisions

Use Bun in a container, existing Hono/Zod/SQLite dependencies, generic backend operations and existing error types. No actual route generation, Web-layer framework, full Multi21 query system, other backend, legacy migration, nested collections or authentication work is included.

ADR 0009 supersedes ADR 0008's controller interpretation: controllers are independent REST-facing operation types, with per-call collection context and explicit output projection. Programmatic resource operations remain separate from HTTP. Update the coding-style statement that previously required every controller to work without HTTP to match this explicit user decision.
