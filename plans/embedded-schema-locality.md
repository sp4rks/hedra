# Embedded-schema locality

## Goal and accepted design

Concentrate embedded-resource schema interpretation in `src/models/embedded.ts` while preserving
Hedra's public behaviour and its route/controller/backend responsibilities. This is an internal
refactor, with no new feature or compatibility migration. The lead accepts this design and the public
test seams below within the requested scope.

## Current knowledge and callers

| Caller | Knowledge it needs | Responsibility retained there |
| --- | --- | --- |
| Collection construction | Default recursive public model | Bind declaration, output and controller choice. |
| Route body parsing | Derived create/PATCH validators and direct embedded fields | HTTP parsing, dictionary addressability and client errors. |
| Route checking and registration | Direct fields and compatible exposed item models | Route names, recursion checks, paths, scope and dispatch. |
| Embedded mutation controller | Field kind, item model and original container schema | Selection, replacement, metadata, timestamps and atomic mutation. |
| Complete-candidate validation | Direct fields and item models | Validate stored candidates and reject identity/metadata changes. |
| Output projection | Direct fields and item models | Filter output and check retained identities, allowing array filtering/reordering. |
| Server registration | Direct embedded names | Association collisions, graph checks and controller lifecycle. |

The existing module already discovers fields, unwraps optional/nullable/default schemas, substitutes
items, derives operation-specific input and builds default output. Routes separately unwrap explicit
output fields and interpret their containers and required UUIDs. That second interpretation is the
knowledge leak to remove. Controllers and the server already consume `embeddedFields`; changing
their policy loops would add churn and risk without improving locality.

## Interface and implementation

Keep `EmbeddedField` and all exports from `src/hedra.ts` unchanged. Keep Collection declarations,
ControllerInterface and scope data unchanged. No routes, request/response schemas, stored records,
dependencies or runtime configuration change.

Inside `src/models/embedded.ts`, share container inspection between embedded discovery and explicit
output interpretation. It recognises only the currently supported wrappers and one array/dictionary
level, and retains the original schema and dictionary key schema. Keep the helper private and keep
`unwrap`/`replaceItem` private if no caller remains outside the module.

Move the current exposed-item interpretation into this module as the internal `publicItem(field,
output)` function. It returns undefined for an omitted field, otherwise returns the compatible
unwrapped item object and requires its UUID field. Route validation and registration call this
function. Preserve current ConfigurationError messages and error order, including the distinction
between mismatched array/dictionary containers and invalid singleton item schemas. Explicit output
schemas need not carry EmbeddedResource's resource-kind registry metadata.

Keep input derivation and default projection in the module. Do not merge mutation, complete-candidate
validation and projection traversal: their identity policies intentionally differ. Keep raw-value
dictionary checks in routes; they must run before parsing can discard unsafe literal keys. Keep
candidate and output checks inside the existing transaction callbacks.

Proposed structure extends the existing files only:

```text
src/models/embedded.ts       Schema discovery, container inspection, input derivation and output definitions.
src/routes/resources.ts      Consume definitions for generated routes; retain transport and route policy.
tests/server/routes.test.ts  Characterize previously uncovered explicit output compatibility cases.
docs/adr/0027-embedded-schema-interpretation.md  Explain the module seam and distinct policies.
```

No prepared registry, cache, generic visitor or compiler framework: recomputation preserves the
existing lifecycle and avoids extra state. This follows ADRs 0009–0013 and 0025 without superseding
them. The new ADR records the locality decision, not a change to validation or resource ownership.

## Accepted test design

Use existing exported Collection/Hedra routes through `app.request` and BaseController methods with
real in-memory SQLite. Do not test internal schema helpers. These seams exercise registration,
parsing, selection, validation, persistence and projection together; they do not claim performance
improvements or support for additional Zod placements.

Reuse these existing tests unchanged:

| Behaviour/failure | Existing test |
| --- | --- |
| Unsupported wrappers and resource declaration restrictions | `collections reject embedded resource definitions in unsupported wrapper shapes`; collection metadata rejection test. |
| Nested mutation ownership and selection | `nested array routes address only the owning resource and update one item`; dictionary/singleton route test. |
| Optional/default/nullable containers | Parent creation, nullable initialization, singleton and container replacement route tests. |
| Replacement and foreign identities roll back | `parent container replacement preserves addressed identities and rejects foreign ones atomically`. |
| Dictionary addressability | `parent dictionary input rejects unsafe keys without changing the resource`. |
| Required/minimum constraints and ancestor timestamps | Nested deletion and ancestor timestamp route tests. |
| Hidden output and default password filtering | Existing owner-policy and omitted embedded-field route tests. |
| Complete-candidate rules and managed metadata | Existing create/update/embedded cross-field and metadata-transform route tests. |
| Output identity and rollback | Existing dictionary, root, array and singleton output identity route tests, and controller output-failure tests. |
| Association ancestry and failed nested creation | Existing association ancestry and failed-output rollback tests. |

Add only uncovered characterizations, before the refactor:

1. `registration rejects incompatible embedded output containers and missing UUID identities`:
   public registration with in-memory SQLite rejects mismatched array/dictionary output, nonobject
   singleton output, and item output with missing or optional/non-UUID IDs. Assert the existing
   ConfigurationError messages. A rejected collection must remain unattached.
2. `wrapped explicit embedded output preserves visible routes and hides nested fields`: use
   optional/nullable/default wrappers on array/dictionary/singleton declarations and explicit output
   items without registry metadata; root and nested responses retain the declared public fields,
   hidden descendants have no route, and an unrelated parent PATCH does not reset defaults.

These are characterization tests of existing behaviour, so they should pass on the unchanged
implementation; do not manufacture failing tests for a behaviour-preserving move. Any actual defect
or newly proposed behaviour requires lead review and a genuine failing test first. Keep additions
focused; report any overlap discovered and reuse existing coverage instead.

## Work and acceptance

1. Commit this plan on `feature/embedded-schema-locality` in its isolated worktree.
2. Configured coder owns source/tests only, adds the characterizations before refactoring, runs
   focused tests and `bun run check`, and reports commit range and evidence.
3. Lead owns docs/examples on `feature/embedded-schema-locality-docs` in its own worktree, using
   docs-style and Diátaxis. Add the short ADR and check references/examples from their stated start.
4. Merge docs into the feature branch, run `bun run check` and examples 05/06, and review the fixed
   diff against this plan. Configured reviewer independently reviews read-only with reviewer skill.
5. Send confirmed findings to the same coder; verify and re-review fixes. Accept only with passing
   checks and no actionable findings. Report actual caller simplification and compatibility.
6. Leave main unchanged until explicit user approval to merge.
