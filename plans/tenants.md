# Tenant catalogue and REST API

## Behaviour and scope

Use the archived Multi21 tenant controller, domain model and collection registration as a design guide. Tenant definitions already live in Hedra's configuration datastore. Expose that catalogue automatically through `GET /tenants`, `POST /tenants`, and `GET`, `PATCH`, `DELETE /tenants/:id` without registering an application collection or opening its backend.

The user chose a required domain that is immutable after creation. Retain the existing required, trimmed, nonempty `name`. Add required `tenantDomain`, trimmed and lowercased, validated as a DNS domain by the exported `Tenant` Zod schema. HTTP creation additionally requires exactly one tenant label below this app's configured `deploymentDomain`; reject the root itself, deeper names, lookalike suffixes and the configured API/docs hostnames. Keep deployment-dependent validation out of the global schema so separate apps can have different configuration.

Every tenant controller operation requires a syntactically valid `Host` matching this app's `deploymentApiDomain`, case-insensitively and ignoring a valid optional port. Missing, malformed or different hosts raise `PreconditionFailedError` (412). Do not trust forwarded-host headers or fall back to the URL when Host is missing. The check must happen before obtaining configuration storage. Host selection does not authenticate callers.

Creation supplies the name and domain; PATCH changes only the name. Reject attempts to set `tenantDomain` through PATCH, including the current value. Keep the existing resource metadata policy: IDs and timestamps are server-owned. Return standard resource/list envelopes, self links, POST Location/201, DELETE 204, 404 for absent resources, existing request validation errors and redacted internal failures. Support the existing scalar equality filter over public Tenant fields. Generated routes retain their existing JSON handling and error representation.

Persist through `app.configDatastore.tenants`, including structural injected implementations. Preserve the datastore object's identity, lazy construction, connection ownership, separation from application storage and close behaviour. HTTP operations reject after app closure even for borrowed stores. Reserve application collection name `tenants` (including association targets) as well as the existing internal table name, before attaching controllers or routes.

In the default ConfigStore, tenant creation validates the complete model and checks domain uniqueness in the same backend transaction as insertion; duplicate canonical domains raise `UniqueViolationError` (409), including concurrent attempts and attempts from separate stores sharing storage. Name updates validate and commit atomically. Programmatic replacement permits the same domain but rejects changing it. Programmatic update rejects any domain field. Preserve ResourceOperations' UUID/timestamp protection. Injected configuration datastores must uphold equivalent tenant validity, immutability and uniqueness guarantees; the controller validates inputs and returned data but cannot supply a transaction around an external store.

Existing name-only tenant data needs a domain supplied out of band before it can be returned through the new API. Do not invent domains or silently migrate data. Update all affected test fixtures and user examples for the required field.

No environments, request tenant resolution, application-data isolation, authentication, authorization, OpenAPI, domain aliases, general unique-index framework, migration tool, new dependency or runtime is included.

## Interface and structure

- Export `TenantController` from `src/hedra.ts`, implementing `ControllerInterface` with `constructor(config: Config, datastore: () => ConfigDatastore)`. The provider allows normal route registration while delaying storage access until an accepted operation. Keep collection/context arguments consistent with existing controllers.
- Reuse generated REST registration and internal body/query/error/response utilities where practical. Bind an internal `Collection('tenants', Tenant)` to the tenant controller without application registration. Do not add backend exposure to ConfigDatastore or force it to inherit a class.
- Extend `src/models/tenant.ts` for the domain schema.
- Put tenant persistence policy beside ConfigStore, in `src/datastores/categories/config/tenants.ts` if needed. A focused ResourceOperations subclass may override create/update/replace; retain inherited reads/deletes and avoid a second CRUD framework. The structural public datastore method surface remains the same.
- Put `TenantController` in `src/controllers/tenant-controller.ts` and wiring/reserved-name checks in `src/server/server.ts`.
- Tests belong in `tests/controllers/tenant-controller.test.ts`, `tests/server/tenants.test.ts` and the existing configuration datastore tests as appropriate.
- The lead owns this plan, glossary, ADR and docs/examples. The coder owns production code and tests and must not edit docs/examples. The lead writes documentation on `feature/tenants-docs` in a separate worktree and merges it into the feature branch after implementation.

Record the catalogue's REST boundary and datastore policy in ADR 0024. This extends ADR 0019's lazy structural datastore contract and ADR 0009's separation of REST and programmatic operations. ADR 0012's atomic validation remains applicable to the default persistence implementation.

## Test design and acceptance

The lead accepts these public seams. Use real SQLite and temporary files, `Hedra.request`, the exported Tenant schema/controller and ConfigStore operations. Do not inspect private fields or mock BaseController. Tests at routes catch wiring, validation and response behaviour; controller tests catch bypasses by direct callers; datastore tests catch persistence invariants and transaction races. They do not establish authentication or application tenant isolation.

Implement one failing test and its smallest passing change per TDD cycle:

1. **Tenant requires a canonical DNS domain.** Missing domains, URLs, ports and invalid labels fail; surrounding whitespace and uppercase normalize. Preserve name and metadata validation.
2. **Tenant REST CRUD uses the configuration catalogue.** Create/list/filter/get/rename/delete via app.request; assert schema-valid data, envelopes, links, Location, server metadata and missing-resource errors. Assert programmatic operations see HTTP writes and HTTP reads see programmatic writes.
3. **All five controller operations reject an absent, malformed or different deployment Host before storage access.** Include direct exported-controller calls, optional ports/case, misleading suffixes and ignored forwarded hosts. A temp default datastore path stays absent after rejected requests.
4. **Tenant domains are direct deployment subdomains.** Cover root, nested label, other domain, suffix without the separator, configured API/docs hosts, empty/invalid names and normalized valid input. Two apps with different Config values must not share domain rules.
5. **Tenant domains are immutable and invalid changes leave storage untouched.** PATCH domain attempts fail even when unchanged; direct controller bypasses fail; programmatic update and replacement preserve the rule. A name-only PATCH retains identity/domain/createdAt and updates updatedAt.
6. **Tenant domains are unique atomically.** Canonical duplicates and concurrent creates return 409 with one resource remaining; separate stores on the same backend/file uphold the invariant. Deleting a tenant allows later creation of the same domain with a fresh ID.
7. **Structural configuration datastores work without exposing a backend.** HTTP uses a plain object matching ConfigDatastore, injected storage is borrowed, no default/application DB opens, close blocks further HTTP access and existing direct borrowed operations still work.
8. **Built-in routes preserve lazy configuration storage and application separation.** Construction, unrelated routes, app collection registration and rejected tenant requests do not open the config store. Default tenants persist across reopening. Registering `tenants` directly or through associations fails without partial registration.
9. **Tenant routes preserve request and failure contracts.** Cover malformed JSON, unsupported media type, unknown fields/filter fields, invalid UUIDs, missing resources, server-owned metadata, corrupt returned data and thrown datastore failures with no sensitive internal detail exposed. Existing generic route coverage can be reused for unchanged shared parsing behaviour.

Run `bun run check` and every executable example with isolated database paths. Review the combined implementation and docs fixed commit range independently using the reviewer skill. Fix confirmed findings through the same coder, rerun affected checks and obtain focused re-review for material fixes. Do not merge into main without the user's explicit approval.
