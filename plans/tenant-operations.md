# Precise tenant operations and validated reads

## Behaviour and accepted design

Recommendation 1 from the codebase-design review is the scope: make the tenant catalogue's interface describe its existing mutation rules and validate full Tenant values returned by `get` and `list`. Keep generic `ResourceOperations` schema-free. The lead accepts this design and the test seams below; implementation needs no further design or test-plan approval.

`ConfigDatastore.tenants` and `ConfigStore.tenants` expose a structural `TenantOperationsInterface` with exactly the existing six operations:

| Operation | Input | Result |
| --- | --- | --- |
| `create` | `TenantInput` | `Promise<Tenant>` |
| `get` | UUID string | `Promise<Tenant \| null>` |
| `list` | optional `Partial<Tenant>` scalar equality filter | `Promise<Tenant[]>` |
| `update` | UUID string, `TenantChanges` | `Promise<Tenant \| null>` |
| `replace` | UUID string, `TenantInput` | `Promise<Tenant \| null>` |
| `delete` | UUID string | `Promise<boolean>` |

Derive shared strict `TenantInput` and `TenantChanges` Zod schemas in `src/models/tenant.ts`. TenantInput omits server-owned metadata; TenantChanges additionally omits the immutable domain and makes the name optional. Export each schema and its derived type through `src/hedra.ts`, together with the structural interface. Reuse the schemas in tenant persistence and TenantController instead of defining copies. Keep runtime rejection of own forbidden keys, including values of undefined. Preserve compile-time metadata exclusion for create/replace, and exclude metadata and tenantDomain from updates, for object literals and pretyped variables. Derive any necessary forbidden-key typing from Tenant and the corresponding mutation schema rather than repeating the tenant shape.

Keep the existing focused TenantOperations subclass. It implements the tenant interface and overrides `get` and `list` to parse all returned values with Tenant using the existing storedTenant validation. Call inherited reads to preserve generic JSON integrity, UUID/timestamp checks, filters, identity checks and error propagation. Return parsed values, including schema normalisation. Missing get remains null; an empty list remains empty. If any selected row is invalid, the complete read rejects with OutputValidationError (500); never silently omit rows, return partial lists, or rewrite data. Filtering and insertion order retain their current behaviour. Unexpected storage/callback failures propagate unchanged.

Creation retains atomic canonical-domain uniqueness. Updates still reject any domain field, even an unchanged value; replacement still requires the current domain. Strict input validation, server-owned metadata, lazy construction, borrowed/owned connections and structural datastore injection retain their existing semantics. Remove ConfigStore's unused Collection construction when binding the named tenant operations directly.

No other review recommendations, generic storage changes, tenant isolation, new runtime/dependency, data migration or main-branch merge are included. Existing invalid/legacy tenant rows now fail programmatic reads and must be corrected outside this change.

## Structure and ownership

Extend existing files; introduce no new production directory or CRUD layer:

- `src/models/tenant.ts`: shared mutation schemas and schema-derived types.
- `src/datastores/categories/config/config.ts`: tenant structural interface and ConfigStore wiring.
- `src/datastores/categories/config/tenants.ts`: precise method types and validated reads.
- `src/controllers/tenant-controller.ts`: consume shared mutation schemas.
- `src/hedra.ts`: deliberate public exports.
- `tests/models/tenant.test.ts`, `tests/datastores/categories/config/tenants.test.ts`, and affected existing config/controller/server tests: public schema, type and runtime coverage.
- `docs/config-store.md`, `docs/tenants.md`, `examples/04-config-store.ts`: caller documentation and executable example.
- `docs/adr/0026-tenant-operations-contract.md`: extend ADRs 0019 and 0024 with the tenant-specific interface and read validation; retain ADR 0009's HTTP/programmatic separation and ADR 0025's error contract.

The lead owns this plan, documentation, ADR and acceptance. The coder owns production code and tests on `feature/tenant-operations`, in `.worktrees/tenant-operations`. The lead writes only docs/examples on `feature/tenant-operations-docs` in its separate worktree while implementation runs. No other worker may revert another chat's edits. The independent configured reviewer reviews the integrated fixed commit range after checks and examples pass.

The project references a user-docs skill that is not installed in the available skill locations. Use the available docs-style and Diataxis guidance and perform an explicit newcomer review of the affected documentation/examples.

## Test design

These public seams are accepted by the lead under the project workflow:

- Exported schemas and TypeScript calls through ConfigStore.tenants and ConfigDatastore.tenants catch schema/type drift and forbidden mutation fields. They cannot enforce an injected datastore's implementation.
- ConfigStore.tenants using real in-memory SQLite catches read validation, parsed output, filtering and persistence invariants. Insert malformed fixtures through the public backend solely as setup; observe results through tenant operations, not private helpers or raw database assertions.
- Hedra.request catches default-store integration and HTTP redaction. Reuse existing coverage for unchanged routing, host checks, mutation atomicity and lifecycle.

Implement one failing test and its smallest passing change per TDD cycle. Record red/green evidence for each new behaviour. Named behaviours:

1. **Tenant mutation schemas normalise valid input and reject domain updates, unknown attributes and supplied metadata.** Cover own undefined forbidden keys as well as ordinary invalid values.
2. **Tenant operation types accept creation/replacement attributes and name-only changes while rejecting forbidden fields.** Exercise both ConfigStore and ConfigDatastore public types, including pretyped variables with a valid name plus forbidden metadata/domain. Use meaningful TypeScript negative assertions and runtime rejection checks; avoid executing deliberately invalid calls without asserting their rejection.
3. **Tenant get rejects stored data that fails the complete Tenant model.** Cover a non-string/empty name, missing/invalid domain and unexpected fields, with otherwise valid identity/timestamps.
4. **Tenant list rejects the whole selected result when a row is invalid.** Include a valid row alongside the malformed row; cover the model failures above without unnecessary duplicate fixtures.
5. **Tenant reads return parsed, canonical data and preserve normal read semantics.** Cover trimming/lowercasing from stored fixtures, identity/timestamps, null/empty results, scalar filters and insertion order. Filtered-out invalid rows do not poison an otherwise valid selection.
6. **Tenant get/list propagate unexpected backend failures unchanged.** Reuse existing public injected-backend tests where possible.
7. **HTTP tenant reads redact invalid data returned by the default store.** Both item and list reads return a generic 500 without malformed resource fields in the response.

Existing tests must continue to prove mutation normalisation, immutability, uniqueness across independent connections, metadata management, injected datastore identity, connection ownership and schema-free generic ResourceOperations behaviour. Adapt negative callers and structural fixtures only as needed for the new contract.

## Acceptance

The coder reports its implementation commit range, red/green evidence and `bun run check` results. The lead merges the docs branch into the feature branch, runs `bun run check` and the affected executable examples, then reviews the combined diff and obtains the independent read-only reviewer verdict. Resolve confirmed findings through the same coder and re-review material fixes. The user approves only the final merge into main; leave the accepted feature branch ready for that decision.
