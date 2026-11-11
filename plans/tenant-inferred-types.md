# Infer tenant mutation types directly

## Behaviour and interface

Remove the private `TenantWrite<T>` helper. Infer exported `TenantInput` and
`TenantChanges` types directly from their existing Zod schemas. The user chose
runtime enforcement over extra forbidden-key typing; models follow ordinary Zod
and TypeScript conventions.

The schemas, exports, routes and controller/datastore runtime behaviour stay as
they are. Existing variables with additional fields may pass TypeScript's
structural checks; strict schemas still reject forbidden fields at runtime.
Object literals retain normal excess-property checking, and required fields and
field value types remain compiler checked. No dependencies or new abstraction.

This supersedes ADR 0026's requirement to reject forbidden fields in pretyped
callers. Record the narrower decision in ADR 0032 and update the configuration
datastore reference. The separate runtime datastore boundary remains necessary
for direct programmatic callers and retains its validation.

## Code structure and scope

- `src/models/tenant.ts`: remove the helper and use plain `z.infer` aliases.
- `tests/datastores/categories/config/tenants.test.ts`: update the existing
  public-contract regression for structural typing with runtime rejection.
- `docs/config-store.md` and `docs/adr/0032-inferred-tenant-mutation-types.md`:
  describe inferred types, the runtime boundary and the revised decision.
- Public callers and exports retain their names. Existing controller/model/route
  tests and runnable tenant examples verify runtime enforcement.

## Accepted test design

Public seams are the exported types, `ConfigStore.tenants` and
`ConfigDatastore.tenants`. The lead accepts these seams and this coverage.

1. **Tenant operations accept inferred structural inputs and reject forbidden
   fields at runtime.** Adapt the existing regression first: remove the negative
   type assertions for pretyped metadata/domain values, verify both store and
   structural catalogue calls still reject with 422, and retain successful name
   updates. Type-checking must fail before removing the helper and pass afterward.
2. **Literal input fields retain normal excess-property checks.** Keep or add
   negative type assertions to the existing `undefined` forbidden-field literal
   calls, which continue to reject at runtime.
3. Run the existing model, direct-controller and tenant-route tests, including
   metadata handling, domain immutability and validation failure paths. Do not add
   duplicate controller tests for unchanged behaviour.

Run `bun run check`. Run `examples/04-config-store.ts` and
`examples/07-tenants.ts` from the feature worktree using their in-memory storage.
The lead and independent configured reviewer must accept the fixed changes.
Merge to `main` requires explicit user approval.
