# Parent-declared contained collections

## Accepted scope

Use one `Resource` schema for independently stored and contained resources. A Collection without a
`parent` has its own storage and root routes. A Collection with a `parent` stores its items in the
parent's existing document and exposes nested CRUD routes. The user explicitly chose nested CRUD
and queries mainly within a known parent. This revises the initial M21 separate-child-storage idea.

Keep references between independently stored resources and their existing deletion protection.
Do not add global child search, secondary-index configuration, a NoSQL backend, physical SQL
columns, automatic data migration or additional storage modes.

## Public interface

```ts
const Note = Resource.extend({ text: z.string() })
const Project = Resource.extend({ title: z.string(), notes: z.array(Note).default([]) })
const projects = new Collection('projects', Project)
const notes = new Collection('notes', Note, { parent: projects })

app.register(projects)
```

The parent schema explicitly describes the persisted document. `notes` names the parent's direct
field and its model is the same item schema. The existing optional/nullable/default wrappers and
array, dictionary and singleton shapes remain supported. No runtime schema extension conceals
fields from the parent's inferred type. Plain nested Zod objects remain ordinary data.

- Add optional readonly `Collection.parent`. Record declared children internally so registering
  either a root or its descendant discovers the same complete tree and constructs all controllers
  before binding any. Define children before registering their parent; reject additions after the
  parent is attached. Keep existing names and instance-ownership rules.
- A child's model must match the item model at `parent.model.shape[child.name]`. Reject missing,
  mismatched or unsupported containers, duplicate child names and cyclic definitions before
  opening storage or binding controllers.
- Child endpoints are nested under their parent item, without a standalone root endpoint or table.
  Singleton parents add no redundant item selector. Dictionary keys remain URL-safe selectors;
  arrays use resource UUIDs. Grandchildren retain the complete containing path.
- Root registration exposes nested routes only for explicitly declared child collections. Merely
  placing a Resource schema inside another schema does not register a collection or its routes.
- Remove the separate `EmbeddedResource` public schema/type and resource-kind distinction. Use
  `Resource` for every identifiable resource; internal embedded helpers may retain their names.
  Detect nested Resource schemas through the existing Resource identity metadata, preserving
  controlled identities, timestamps, input derivation and complete-document validation.
- Keep the five controller methods and `(backend)` construction. Dispatch each contained request
  to the child's selected controller with that child Collection, retaining extra-method inference.
  Supply the root collection and traversal privately for BaseController's containing-record access.
  A direct child-controller call without a valid containing scope fails instead of writing a child
  table. Validate that supplied scope corresponds to the declared root/parent path.
- Keep the data-only ResourceScope and embedded/association accessors. For contained routes,
  `scope.collection` names the child whose controller receives the call; `target` retains the
  containing rootId and complete EmbeddedStep path. Root and association scopes are unchanged.
- The containing root's output policy remains authoritative, including hidden fields and filtered
  items. Child output is derived from its parent's exposed item definition; configure child public
  fields in the parent's output schema. Reject a separate outputValidator on a parent-declared
  collection instead of allowing parent reads to expose fields hidden only by a child endpoint.
  A hidden child field has no exposing routes. Keep compatible container/identity checks.
- Associations remain links between independently stored collections. Reject contained collections
  as either endpoint or association sources: they have no independent table or root identity.
  Association navigation to a root may continue into its declared contained collections.

## Storage and behaviour

SQLite continues storing each root record in its existing JSON `data` column. Child creation,
updates and deletion atomically modify that record; no child table, copied independent resource,
parentId attribute or association link is created by containment. Generic Backend and
ResourceOperations contracts remain unchanged.

Preserve managed metadata, parent container-replacement rules, dictionary identity, ancestor
existence checks, sibling isolation, cross-field/container validation and failure rollback. Child
mutations refresh their containing resource ancestors. Ordinary nested values receive no resource
metadata or routes. Parent-scoped scalar filtering and HTTP statuses remain unchanged.

Owned children share their root's lifetime. Deleting a root removes its contained data. Any declared
association involving that independent root still blocks deletion with 409 and blocking links until
explicitly unlinked. A contained child cannot be independently linked elsewhere through the existing
association API. Arbitrary UUID-valued attributes are not automatically interpreted as references.

This replaces the declaration/route inference in ADR 0010 and ADR 0027 and revises ADR 0028's
collection field for contained dispatch. Record ADR 0029; preserve their historical content with
supersession notes. Keep generic transactions (0011), complete-candidate validation (0012), output
redaction and backend connection lifecycle.

## Structure and affected callers

```text
src/models/collection.ts       Parent declaration, child discovery and controller lifecycle.
src/models/resource.ts         One resource base and metadata recognition.
src/models/embedded.ts         Existing container interpretation and input/output derivation.
src/models/scope.ts            Public address plus private containing-collection traversal.
src/routes/resources.ts        Explicit child routing and selected-controller dispatch.
src/controllers/controller.ts  Root operations and correctly scoped contained dispatch.
src/controllers/embedded.ts    Existing atomic containing-document operations.
src/server/server.ts           Validate and register root/child/association graphs atomically.
src/hedra.ts                   Deliberate exports; remove EmbeddedResource.
tests/                        Adapt declaration fixtures and verify changed public behaviours.
docs/, examples/              Current reference, runnable declarations and migration notes.
```

Reuse existing helpers and tests. Do not add a parallel contained-resource implementation or
compatibility alias. Existing persisted contained JSON can remain in place when schema/field names
are retained. Update consuming declarations and scope assertions. Do not delete or rewrite existing
database tables. Independent roots and association records retain their storage representation.

## Accepted test design

The lead accepts public package/Collection construction, generated routes through `app.request`,
exported controller calls and exported scope accessors as the seams. Use real in-memory SQLite,
plus existing file-backed reopen coverage. Inspect persistence through parent resource responses
and public backend operations only where storage ownership is the behaviour being asserted.

Write one failing behaviour test, implement it and make it pass before the next slice. Adapt
existing behaviours to Resource plus explicit parent declarations rather than deleting their
coverage or keeping legacy EmbeddedResource fixtures.

| Behaviour/test name | What the seam verifies |
| --- | --- |
| parent-declared collections persist children inside their parent and expose only nested CRUD | Full lifecycle, parent GET reflects edits, separate owners remain isolated, root child route absent and no separately stored child records. |
| parent declarations require matching schema fields and valid collection graphs | Missing/mismatched fields, unsupported wrappers, duplicates, reserved names, cycles, association/contained conflicts and attachment failures leave registration reusable. |
| Resource fields receive no generated routes without a child collection declaration | Plain data and undeclared nested resources cannot accidentally create endpoints. |
| child collections dispatch to their own controller with complete data-only scope | Root/child Collection identity, extra methods, array/dictionary/single/deep selectors and associated-root ancestry. |
| contained controller calls require the declared containing scope | No fallback child-table writes; malformed or unrelated root/path scope cannot select another owner. |
| child output follows the containing parent's public policy | Hidden fields/items, password filtering, derived child output, incompatible custom output, identity remapping and output failures preserve confidentiality and rollback. |
| contained mutations preserve metadata and validate the complete containing document | Existing managed-field, cross-field, required/minimum container, failed storage/projection, literal-key and sibling timestamp tests remain meaningful. |
| parent storage and contained identities survive reopen | Existing file-backed coverage works with the new declaration. |
| associations retain deletion protection and cannot target contained collections | Root references block either endpoint until unlinked; owner deletion removes owned values only; invalid child links never leave records. |
| registration failures leave all pending controllers and routes unattached | Existing constructor failure, graph reuse and closed/borrowed-backend guarantees apply to contained trees. |

Run focused tests during slices, then `bun run check`. No new dependencies or lowered coverage gates.

## Delivery and acceptance

Design and test design accepted by the lead within the user's clarified scope. Implement on
`feature/parent-collections` in `.worktrees/parent-collections`; the configured coder owns production
code and tests. Lead owns this plan and GLOSSARY.md, and docs/examples on the separate
`feature/parent-collections-docs` worktree. Implementation and documentation run in parallel.

Merge docs into the feature branch, run full checks and every changed runnable example from the
documented repository-root starting point. Lead reviews the fixed range against this plan, and the
configured independent reviewer applies the reviewer skill. Return confirmed findings to the same
coder, rerun affected checks and re-review. Acceptance requires passing checks and no actionable
findings. Report the branch and migration implications; merge into main only after user approval.
