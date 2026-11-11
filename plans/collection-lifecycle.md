# Keep collection registration state on the collection

Status: implemented, verified and independently reviewed. Merge to `main` requires user approval.

## Accepted scope and design

The user requested replacing Collection's WeakMaps and exported lifecycle functions with `@internal` class methods, removing unused `attachCollection`, and preserving construct-before-bind registration and custom controller typing.

Collection stores its selected controller constructor and optional bound controller in JavaScript private fields. Keep the selected constructor readonly. This preserves runtime privacy and avoids storing a per-collection factory closure or erasing controller values to `unknown`.

The class exposes these lifecycle members for Hedra, each with a purpose comment and `@internal`:

```ts
get isAttached(): boolean
createController(backend: Backend): C
bindController(controller: C): void
```

`createController` constructs without binding. `bindController` attaches an already constructed controller. The existing public `controller` getter continues to throw before registration and returns the exact selected controller type afterward. Preserve the conditional constructor options requirement for explicitly typed custom controllers, all name/model/options validation, output filtering, frozen associations and controller/backend lifecycle rules. The default constructor assertion remains local if TypeScript still needs it.

Hedra replaces its lifecycle function imports with calls to these members. Registration validates the full association graph, constructs every pending controller, and only then binds controllers and installs routes. The built-in tenant collection binds its existing TenantController directly, retaining lazy configuration datastore construction. Remove both WeakMaps and all four exported lifecycle functions; no other callers exist.

`@internal` documents framework ownership; it does not restrict access. The methods remain callable on the exported class. Do not add declarations, `stripInternal`, friend access, symbols, wrappers or lifecycle options to hide them. This refactor does not contradict the independent controller contract in ADR 0009 or the tenant configuration boundary in ADR 0024. No new durable architectural decision is needed.

## Accepted test boundaries

Test through package exports: `new Collection`, `Hedra.register`, `collection.controller`, HTTP requests through `app.request`, and the existing public type assertions. Do not directly test the internal lifecycle members or inspect private fields.

| Behaviour | Evidence |
| --- | --- |
| Collection metadata and invalid definitions retain their contract | Existing collection definition tests. |
| Registration selects the default or custom controller and preserves custom methods | Existing registration tests, typed `byMake` call and compiler rejection of a custom type without its constructor. |
| A later constructor failure leaves earlier constructed collections unbound and reusable | Strengthen `failed graph registration leaves every collection reusable`: construct the associated target successfully, then throw from the source controller; both getters still throw, both routes remain absent, and another app can register the graph after the failure is disabled. |
| Duplicate names, reuse, failed registration and shutdown retain their contract | Existing Hedra tests, including saved controllers and a borrowed backend. |
| Built-in tenants continue to use the configuration catalogue | Existing tenant tests and reserved-name checks. |

This is a structural refactor with no intended behaviour change. Run the existing focused tests and the strengthened failure test before production edits, then rerun after implementation; do not invent a failing behaviour to justify the refactor. Run `bun run check` for types, formatting, import order, lint and coverage. Existing logging and listener tests may need execution outside the filesystem sandbox, as confirmed during the initial review.

## Ownership and acceptance

The lead owns this plan, test design, documentation and acceptance. The configured coder owns `src/models/collection.ts`, `src/server/server.ts`, `tests/models/collection.test.ts`, `tests/server/hedra.test.ts` and `tests/server/associations.test.ts` in `.worktrees/collection-lifecycle`; only change tests when they add distinct public evidence. The coder must preserve others' edits and report its commit range, baseline and final checks, and any deviations.

In parallel, the lead updates the lifecycle reference in `docs/collections.md` on `feature/collection-lifecycle-docs` in its own worktree, touching only `docs/` and `examples/`. Document framework ownership of the internal lifecycle members without promoting manual registration. Check links and run the documented independent examples from their stated repository-root starting point after integration.

Merge docs into the feature branch, run checks and examples, review the fixed commit range against this plan, then obtain independent read-only review from the configured reviewer. Send confirmed findings to the same coder and rerun affected checks before acceptance. Leave `main` unchanged until the user approves merging the completed change.

## Verification results

- The coder ran the focused baseline and strengthened graph regression before production edits: 33 tests and 199 assertions passed. This refactor preserves behaviour, so no new failing behaviour was introduced.
- Implementation commit `df91d72` removes both WeakMaps and all four lifecycle functions, stores typed state in JavaScript private fields, and updates Hedra's application and tenant binding. The existing custom-controller type guards remain unchanged.
- `bun run check` passed for implementation and again after documentation integration at `3936684`: TypeScript, Biome, 264 tests with 1,262 assertions, and the coverage gate. Collection has 100% line and function coverage. The ignored worktree uses a symlink to the root's existing dependencies; no dependencies or tooling changed.
- The lead ran `examples/05-resource-controller.ts`, `examples/06-embedded-resources.ts` and `examples/07-resource-scope.ts` independently from the integrated worktree root. All passed, including their assertions and cleanup. The lifecycle reference matches the implementation; all 21 local links and anchors resolve.
- The lead reviewed the implementation and integrated documentation against this plan. Construct-before-bind registration, tenant configuration storage, custom-controller inference and validation are preserved. `git diff --check` passes and the feature worktree has no tracked changes before this verification record.
- Independent read-only review of `002da53..e22d13e` found no actionable issues. The reviewer independently passed TypeScript, Biome, `git diff --check` and 18 focused tests with 135 assertions, relying on the recorded full-suite and example runs. Verdict: ship, subject to the required user approval before merging into `main`.
