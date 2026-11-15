# Work after the environment-scoping walkthrough

Work through these items one at a time. Checked items are implemented and reviewed.

- [x] **Reusable child resources and schema registration.** Implement `child: true` metadata for
  reusable contained resources with nested CRUD, and register schemas directly without a public
  Collection wrapper. Follow [ADR 0033](../docs/adr/0033-schema-registration-and-reusable-children.md).
- [ ] **Signed request scope.** Add signing middleware so signing is the sole proof of request-scope
  provenance. Controllers verify that proof and enforce ownership using the verified scope. Define
  the signing mechanism after the walkthrough; only the requirement is settled here.
- [ ] **Remove compatibility for omitted core Resource fields.** Require all core fields during
  application registration, then remove filtering and restoration of undeclared metadata. Retain
  complete-record validation, server-owned field protection and JSON safety checks.
- [ ] **Remove the standalone associations controller.** Remove `src/controllers/associations.ts`
  and update its callers as part of the resource/reference follow-up. Preserve required reference
  checks and atomic deletion protection.
- [ ] **Use domains as primary catalogue references.** Address tenants by `tenantDomain` and
  environments by `environmentDomain`, with the verified `tenantDomain` retained as explicit scope
  for environment operations. Update catalogue interfaces, lookups, controllers, middleware, built-in
  REST item paths, self links and callers consistently. Retain UUIDs as internal row identifiers;
  preserve domain immutability, permanent reservations and atomic ownership checks.
- [ ] **Rename the shared record parser.** Rename `catalogueRecord()` to `parseRecord()` in
  `src/datastores/categories/config/records.ts`, updating imports and callers without changing
  behaviour.
- [ ] **Web handlers with colocated validators.** Create actual handlers in `src/web` and define
  their request validators in the same handler file, using M21's handler flow as a reference. Replace
  the standalone `src/routes/catalogue-inputs.ts` arrangement; keep route registration in `src/routes`.
