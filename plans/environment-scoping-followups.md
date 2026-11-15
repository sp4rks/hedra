# Work after the environment-scoping walkthrough

All items are implemented and reviewed. The remaining work ran in three parallel streams: scope
signing, Resource contract cleanup, and catalogue/web changes. Domain references preceded handler
extraction; the parser rename shared the catalogue stream. The combined revision passed `bun run check`.

- [x] **Reusable child resources and schema registration.** Implement `child: true` metadata for
  reusable contained resources with nested CRUD, and register schemas directly without a public
  Collection wrapper. Follow [ADR 0033](../docs/adr/0033-schema-registration-and-reusable-children.md).
- [x] **Signed request scope.** Middleware issues process-local HMAC-SHA-256 proofs bound to their
  request Context and tenant/full-scope purpose. Signing is the sole proof of scope provenance;
  controllers verify it before parsing a detached scope and separately enforce record ownership.
  Unsigned, edited, deleted and replayed proofs fail closed.
- [x] **Remove compatibility for omitted core Resource fields.** Require all core fields on registered
  application roots and managed children. Remove filtering and restoration of undeclared metadata;
  retain complete-record validation, server-owned field protection and JSON safety checks.
- [x] **Remove the standalone associations controller.** Move its unchanged persistence operations to
  `src/datastores/associations.ts` and update callers. Preserve the programmatic link API, reference
  checks, storage and atomic deletion protection.
- [x] **Use domains as primary catalogue references.** Address tenants by `tenantDomain` and
  environments by `environmentDomain`, with the verified `tenantDomain` retained as explicit scope
  for environment operations. Update catalogue interfaces, lookups, controllers, middleware, built-in
  REST item paths, self links and callers consistently. Retain UUIDs as internal row identifiers;
  preserve domain immutability, permanent reservations and atomic ownership checks.
- [x] **Rename the shared record parser.** Rename `catalogueRecord()` to `parseRecord()` in
  `src/datastores/categories/config/records.ts`, updating imports and callers without changing
  behaviour.
- [x] **Web handlers with colocated validators.** Actual handlers live in `src/web`, with tenant and
  environment request validators in their handler files. M21's handler flow served as a reference.
  Remove `src/routes/catalogue-inputs.ts`; keep route registration and discovery in `src/routes`.
