# Remove nested CRUD

## Accepted design

The user requested removal of all nested CRUD after choosing plain Resource-derived schemas for
parent/child data. Collections now describe independently stored resources only. Nested objects,
arrays and dictionaries are ordinary schema-validated attributes, read and replaced through the
containing resource. No generated path traverses a resource item to another collection or value.

Remove contained CRUD and association-navigation CRUD, including generated nested association
unlink routes. Keep independently stored resource CRUD and the programmatic association
link/list/unlink interface, including atomic endpoint checks and 409 deletion protection. The user
has repeatedly required references to block deletion until removed; removing nested HTTP routes
does not remove that requirement.

## Interface and behaviour

- Keep Resource, Collection, the five controller methods, Backend/ResourceOperations, root routes,
  scalar filters, error envelopes, controller typing and connection lifecycle.
- Remove Collection.parent, child declarations/discovery and contained endpoint naming. Every
  Collection uses its own root path and table, with existing lowercase storage-name grammar.
  Reject obsolete parent options rather than silently changing their storage meaning.
- Remove models/embedded.ts and controllers/embedded.ts, not merely their exports. Delete resource
  kind markers, schema discovery, traversal, dictionary URL checks, per-child metadata, contained
  replacement-identity reconciliation and contained output-identity machinery.
- Remove EmbeddedStep, EmbeddedScope, AssociationScope, getEmbeddedScope and getAssociationScope
  package exports and internal traversal/ancestry setters. Keep ResourceScope/getResourceScope as
  data-only { collection, target }, with target collection or resource UUID. There is no ancestors
  property whose value is always empty. Root custom controllers continue receiving Context and
  the selected Collection.
- Generated HTTP routes are GET/POST /collection and GET/PATCH/DELETE /collection/:id only.
  /projects/:id/notes, associated-resource navigation and nested unlink URLs return 404 for every
  formerly supported method. Custom application Hono routes remain possible.
- Nested schemas use ordinary Zod semantics. Resource-derived values may be nested, but any id or
  timestamp declared inside them is caller/model data, not metadata generated or protected by
  Hedra. Applications can omit managed fields from nested schemas when they do not need them.
  Ordinary wrapper objects, arrays, dictionaries, unions and lazy definitions receive no special
  resource-placement restrictions. Do not force schema introspection solely to find resources.
- POST/PATCH input derivation omits managed metadata at the addressed resource level only. PATCH
  validates supplied fields without filling omitted defaults. A supplied nested object/container
  replaces that top-level attribute; there is no deep PATCH, child-ID reconciliation, child
  timestamp refresh or dictionary selector. Dictionary keys are data, not URL selectors.
- Preserve complete-candidate validation inside the root write transaction, cross-field/model
  rules, root ID/audit protection, JSON integrity, output cloning and failure rollback. Simplify
  candidate validation to the addressed resource; nested values follow their model's normal rules.
- Preserve confidentiality: default output omits passwords and undeclared fields even for existing
  directly nested Resource models; explicit output schemas remain authoritative. A small generic
  schema/output helper is acceptable when necessary for this guarantee, but do not recreate the
  removed embedded-resource interpretation layer or managed-child machinery under another name.
  Root output cannot change exposed root identity. Nested values have no special identity rules.
- JsonApiListResponse has array data only; dictionary-list responses existed for removed endpoints.
- Programmatic associations still validate registered collection declarations and both endpoints,
  link idempotently, list blockers and unlink without deleting either resource. Remove contextual
  association scope/unlinkFrom and route-only helpers; ordinary root DELETE checks existence and
  associations in the same backend transaction as deletion. Keep models/association.ts as the
  small reference/association schemas used by this surviving behaviour.

## Structure, consequences and migration

```text
src/models/collection.ts       Independent collections and existing controller lifecycle.
src/models/resource.ts         Resource schema, root model validation, minimal output derivation.
src/models/scope.ts            Addressed root collection/resource data only.
src/routes/resources.ts        Root body/query parsing, error envelopes and five root routes.
src/controllers/controller.ts  Root CRUD and atomic reference deletion guard.
src/controllers/validation.ts  Complete addressed-resource validation and metadata protection.
src/controllers/projection.ts  Public output, JSON safety and addressed identity protection.
src/controllers/associations.ts Programmatic links, existence checks and deletion blockers.
src/models/embedded.ts         Delete.
src/controllers/embedded.ts    Delete.
```

Update all exports, callers, tests and runnable examples. Remove tests that exclusively specify
deleted capabilities; retain or rewrite tests covering still-supported validation, confidentiality,
transactions, controller types and lifecycle. No new dependencies or lowered coverage gates.

Existing JSON and independent association records are not rewritten or deleted. Remove parent
Collection declarations from consuming apps and update children through parent writes. Existing
nested metadata remains ordinary persisted data; clients/models now supply any nested fields they
require. Existing nested-resource and ancestor-scope callers must migrate. Programmatic unlink
replaces generated nested unlink URLs. No automatic migration, reference inference, new HTTP link
interface, search/indexing feature or physical SQL schema change is included.

Record ADR 0030, superseding ADR 0029's parent declarations and nested CRUD. Add revision notes to
0010/0027/0028 where needed, preserving historical text. Generic transactions (0011), complete
candidate validation (0012), root output guarantees and lifecycle remain. Lead updates glossary
and owns docs/examples in the separate docs worktree.

## Accepted test design

The lead accepts public Collection construction/package types, app.request, exported controller
calls, getResourceScope and app.associations as the seams. Use actual in-memory SQLite and retain
appropriate existing reopen/lifecycle coverage. One failing behaviour test then smallest passing
implementation per TDD slice. The removal itself should produce a substantially smaller system.

| Behaviour | Public evidence |
| --- | --- |
| nested values are read and replaced through root CRUD only | Arrays, objects and dictionaries persist through POST/GET/PATCH; all removed nested methods return 404 and do not change the parent. |
| nested Resource data uses ordinary schema semantics | Caller/model nested IDs/timestamps survive; missing required nested fields fail normally; ordinary wrappers/unions are not rejected as resource placement. |
| root writes retain complete-model validation and rollback | Cross-field/container errors, managed root transforms, failed projection and storage leave existing state unchanged. |
| output keeps private nested fields hidden without mutating storage | Existing nested password/unknown-field safety, explicit output policies, clone protection and root output-identity checks survive the simplification. |
| associations work programmatically and keep deletion blockers | Canonical endpoint creation, idempotent link/list/unlink, 409 until last link removed, surviving endpoints; no navigation/unlink HTTP routes. |
| generated scope identifies only the addressed collection or resource | Root/controller selection, custom method inference, UUID validation, detached scope; old embedded/ancestry exports are absent. |
| obsolete parent declarations reject and registration remains atomic | Root naming, graph conflicts, failed constructors/retry and closed/borrowed backends retain their supported guarantees. |

Run focused tests during implementation, then bun run check. Lead runs all changed standalone
examples from the feature root and checks documentation links/meaning. Independent configured
reviewer reviews the fixed complete range against this plan after checks pass. Send confirmed
findings to the same coder; rerun affected checks and re-review. User approval is required before
merging into main. Show the user source-code-only diffs from the implementation worktree.

## Verification before independent review

- Main baseline: f1d05cb; implementation commit: 9fd7bbd.
- Integrated bun run check passed: 243 tests, 0 failures, 99.76% line coverage and 99.30% function
  coverage; typecheck and Biome passed. Sandbox local-server/subprocess tests required the approved
  unsandboxed run after EPERM failures.
- Red/green evidence covers removed navigation/unlink endpoints, ordinary nested Resource data,
  formerly rejected schema wrappers, safe JSON keys and nested readonly/transform privacy. Tests
  also cover default/catch sanitization, cross-field rollback, ordinary duplicate nested IDs,
  programmatic deletion blockers and the narrower scope/list forms. Supported root validation,
  lifecycle and concurrent association checks remain.
- Lead reran examples 05-resource-controller.ts, 06-nested-data.ts and 07-resource-scope.ts from the
  implementation root after the final privacy change; all pass.
- Checked all 54 local links/Markdown heading anchors in affected reference and ADR pages. Updated
  the documented transform limitation: use explicit output validators for transforms requiring
  private input or a different public shape.
- Existing data and main remain unchanged. No automatic migration, push or deployment occurred.

## Review and final acceptance

Independent review found private-field exposure through tuples/intersections, then through dynamic
dictionary alternatives inside composed containers. The same coder fixed those findings in
baefd7d and 4cec6dd, with red/green public HTTP regressions for fixed/rest tuples, object and array
unions, composed intersections, preprocessing, wrappers, cycles and harmless schema reuse. Default
output now fails closed for ambiguous dynamic compositions; explicit public schemas remain
available. Ordinary dictionary entries named password retain their data meaning.

The final bun run check passed with 250 tests, typecheck, Biome and all per-file coverage gates.
Lead reran all three documented examples after 4cec6dd; all pass. Local link/anchor checks pass.
Lead review found no remaining actionable issues against this plan. The configured independent
reviewer re-reviewed 4cec6dd, confirmed the findings resolved with six focused HTTP probes and
returned no actionable findings and a ship verdict.

Accepted on feature/no-nested-crud. Both embedded modules, all generated nested routes, parent
declarations and obsolete scope APIs are removed. Root CRUD, complete-candidate validation,
confidentiality, lifecycle and programmatic reference deletion guards remain. Existing data is
unchanged. A source-only patch is prepared from the implementation worktree against f1d05cb.
No merge into main, push, deployment or automatic migration has been performed. Main merge
requires explicit user approval.
