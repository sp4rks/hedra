# Data-only resource scope

Status: design and public test seams accepted by the lead within the requested scope. Implementation is authorised; merging into main requires user approval.

## Problem and callers

Generated REST routes pass positional controller arguments and install embedded/association ancestry in Hono Context. The `id` argument means a UUID, dictionary key or singleton field name. Exported `EmbeddedStep.field` currently carries `EmbeddedField`, including Zod models, container schemas and key validators.

Real callers are `BaseController`, its embedded helpers, association operations, two generated-request scope tests and one malformed-context error test. No repository custom controller or example depends on schema-bearing public scope beyond the test reading `step.field.name`. Collection's custom-controller extra-method typing and direct controller callers must continue to work.

The scope module becomes a deep module: custom controllers learn one data-only description; route discovery, schema selection and atomic traversal stay behind its interface. Keep the five REST operations, their arguments, nongeneric controller types and Hono Context. Do not add a second controller interface or a deprecated schema-bearing scope.

## Public interface

Export Zod schemas and their inferred types from `src/hedra.ts`:

```ts
// Illustrative inferred shapes; production definitions come from Zod.
type EmbeddedStep =
  | { field: string; kind: 'array'; id?: string }
  | { field: string; kind: 'dictionary'; key?: string }
  | { field: string; kind: 'single' }
type EmbeddedScope = { rootId: string; steps: EmbeddedStep[] }
type ResourceScope = {
  collection: string
  target:
    | { kind: 'collection' }
    | { kind: 'resource'; id: string }
    | ({ kind: 'embedded' } & EmbeddedScope)
  associations: AssociationScope
}
```

`AssociationScope` stays an ordered array of `ResourceReference` values. Collection names reuse the ResourceReference validator; resource/array IDs reuse ResourceId. Field names are valid generated route field names. Dictionary selectors are decoded, validated strings, including non-UUID keys; reject empty, dot, dot-dot and prototype keys as routes already do. Use strict object schemas so schema-bearing fields cannot pass as public data. Embedded steps are nonempty; all preceding array/dictionary steps select an item, while the final step may identify its container. A singleton never carries an id/key; a dictionary never uses an id; an array never uses a key.

`getResourceScope(context): ResourceScope | undefined` returns the complete description for every generated resource REST request, including root and associated collection/create requests. `collection` names the independent collection whose controller receives the request. `target.kind === 'collection'` addresses that collection (GET list / POST create); `'resource'` carries its selected UUID; `'embedded'` carries the independently stored containing resource's UUID and all embedded steps in URL order.

For array list/create, the final step has no id; the new UUID does not exist yet. Array item methods carry its UUID. Dictionary list has no key; dictionary create carries the validated `?key=` selector; item methods carry the decoded path key. All singleton operations identify the field itself. Parent steps always select their containing embedded item.

`associations` contains independent-resource ancestors, outermost first, excluding the addressed collection's resource/root. It is empty on ordinary root/embedded routes. An associated embedded request includes both its association ancestors and its own root/steps.

Keep `getEmbeddedScope(context): EmbeddedScope | undefined` and `getAssociationScope(context): AssociationScope | undefined` as projections of the same canonical scope. Their absence semantics remain: undefined when the corresponding ancestry is absent. `getResourceScope` is undefined on arbitrary custom Hono routes or direct controller calls unless a generated handler supplied scope. Accessors validate and return detached data, containing no model/schema objects or functions. The description identifies a requested address; existence and authorisation are still controller responsibilities.

Remove `EmbeddedField` from package exports; it is traversal metadata, with no demonstrated consumer outside internal routes/controllers. Keep its internal definition where needed. `EmbeddedStep.field.name` becomes `EmbeddedStep.field`; `.field.kind` becomes `.kind`; `.selector` becomes `.id` for arrays or `.key` for dictionaries. Controller arguments and AssociationScope values are unchanged. Document these deliberate compatibility changes without a compatibility adapter.

## Internal structure and invariants

Extend existing files rather than introducing architectural layers:

```text
src/models/scope.ts          public data schemas, canonical context scope and accessor projections
src/models/embedded.ts       internal schema-bearing embedded traversal metadata, if needed
src/routes/resources.ts      validate addresses and install scope before each controller dispatch
src/controllers/controller.ts  preserve REST methods; use internal traversal rather than public schema objects
src/controllers/embedded.ts  preserve traversal, ownership, projection and transaction behaviour
src/controllers/associations.ts  retain association checks and unlink context semantics
src/hedra.ts                 deliberate public exports
tests/server/scope*.test.ts  generated requests through custom controllers
docs/collections.md          authoritative scope reference and migration
examples/07-resource-scope.ts  independently runnable custom-controller demonstration
```

Routes already discover schema-bearing embedded fields. Retain that machinery as internal metadata (for example request-local traversal held privately), separate from the public description. Do not rediscover schemas in custom controllers or expose traversal setters through the package. Choose the smallest internal arrangement that preserves existing behaviour; return to the lead for any public contract change.

Preserve request validation ordering and all response envelopes, status codes, Location/self links, output filtering, ownership checks, full association-chain validation and rollback. Association unlinking does not dispatch a resource controller; its internal ancestry still must be available to association operations without claiming an incorrect REST target. Direct BaseController calls with ordinary Hono contexts continue using the explicit arguments.

ADR 0009 remains accepted: the five nongeneric REST operations with per-call Context/Collection are unchanged. ADRs 0010–0013 retain embedded ownership, atomic checks, complete candidate validation and Zod-derived data models. Record the scope decision as a complementary ADR; no superseding ADR is necessary. No database migration, runtime/dependency change, authentication feature or alternate controller paradigm is in scope.

## Lead-owned test design

Use package exports, generated `app.request` calls, a custom controller recording exported scope values before calling super, and real in-memory SQLite. These exercise the same seam as consuming applications and also verify dispatch/default behaviour; they do not prove arbitrary custom controller authorisation. Use literal expected data with IDs from successful response models, never snapshots derived from route internals. Keep meaningful existing route/association/transaction regressions.

Implement one failing test and its minimal passing change at a time:

| Behaviour/test name | Evidence at the accepted public seam |
| --- | --- |
| `root REST requests describe collection and UUID targets` | All five methods receive complete scope, empty ancestry, appropriate collection/resource kind, and unchanged response status/envelopes/links. |
| `embedded array requests distinguish containers from UUID selectors` | List/create omit final id; lookup/update/delete include UUID; preceding selectors are retained. Existing custom-controller override signatures still compile. |
| `dictionary requests expose validated keys rather than resource UUIDs` | List omits key; POST includes query key; item methods include decoded path key (exercise an encoded key). The stored item's UUID is distinct from its key. |
| `singleton requests identify their field without an id or key` | Create/read/update/delete identify a single field; nested traversal through that field keeps it in order. |
| `association chains describe every ancestor and the addressed target` | At least two association hops, collection/create and item requests; ancestors exclude addressed resource, and direct target route has none. |
| `association and embedded traversal compose in one data-only scope` | Two association hops plus nested array/dictionary/singleton steps retain independent root and complete ordered ancestry/selectors. Verify through the receiving custom controller. |
| `public accessors return only documented detached data` | Exact equality for ResourceScope and both legacy-name projections; serialisation/structuredClone succeeds with unchanged content; mutating returned data does not change a subsequent accessor or default enforcement. Schema-bearing properties/functions never appear. |
| `scope schemas reject invalid addressing combinations` | Public schema validation rejects schema-bearing fields, wrong selector kind, invalid UUID, empty steps, unsafe key and unselected intermediate array/dictionary steps. Includes malformed context raising HedraError via public accessor and undefined on custom routes. |
| `invalid generated selectors reject before custom controller dispatch` | Invalid root/array UUID and unsafe dictionary key return 422 without a recorded controller call. |
| `ownership and complete association checks survive scope projection` | Wrong embedded owner and broken first/intermediate association link return 404; failed nested create leaves resources and links unchanged through public reads. Extend existing regressions only where the scenario lacks coverage. |

Existing `tests/models/collection.test.ts` and `tests/controllers/rest.test.ts` preserve extra-method typing, nongeneric controllers and direct calls. Existing suites exercise projection, nested writes, rollback and lifecycle. Do not replace them with internal tests.

## Delivery and acceptance

The configured coder owns src/ and tests/ on feature/resource-scope in its worktree, follows TDD, runs bun run check and reports commits, red/green evidence and deviations. The lead owns this plan and documentation/examples; work on feature/resource-scope-docs in a separate worktree touching only docs/ and examples/. Merge documentation into the feature branch, run bun run check and affected examples (05, 06, 07), and perform newcomer/link/meaning checks. Lead review and configured independent read-only reviewer review the fixed range against this plan and verification evidence. Send confirmed code findings to the same coder, recheck fixes, and accept only with no actionable findings. Prepare a concrete merge decision for the user; do not merge main without approval.
