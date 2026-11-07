# Explicit validation errors and native failure propagation

## Accepted behaviour

The user asked to use `safeParse` and explicit validation errors, remove redundant catch-and-rethrow blocks throughout Hedra, delete `hedraError()` and every executable use/import, update the error-handling ADR, and keep `feature/tenants` unmerged.

Expected invalid data is checked where its meaning is known. Use model/schema `safeParse` results and throw the existing appropriate error directly: `InputValidationError` for request/programmatic input, `OutputValidationError` for stored/projected resource data, `ConfigurationError` for environment/collection definitions, and the existing `QueryError` or transaction classes for explicit backend contract violations. Use parsed data and retain useful validation issues in error detail. Keep exported Zod schemas and current domain/business-rule errors unchanged.

Unexpected native, filesystem, SQLite, logger, injected dependency and user callback failures propagate unchanged, including their identity and any existing native cause. Thrown non-Error values from programmatic callbacks also propagate unchanged. There is no blanket promise that every Hedra operation throws a HedraError. Do not replace the deleted helper with a generic error-normalisation wrapper, proxy or renamed equivalent. Existing `parseInput` may remain as a focused `safeParse` plus explicit InputValidationError helper; it must not catch unexpected exceptions. Keep other validation direct and local unless an existing helper clearly applies.

Remove catches whose sole action is normalising/rethrowing, including constructors, controllers, resource operations, logger methods, app/backend guards and SQLite methods. Keep app-closed and session-lifetime checks. A saved app controller must reject after closure without closing a borrowed backend. Preserve synchronous transaction sessions, rejection of async/nested/expired sessions, SQLite rollback and session-state reset in `finally`. Registration must still close an owned backend opened during a failed registration and leave collections unattached; its cleanup catch rethrows the original failure. Keep catches that turn malformed JSON into expected request errors and the existing generated-route HTTP response boundary, which redacts all unexpected/internal failures into the established generic 500 envelope.

This does not implement the user's future global middleware, change authentication/tenant isolation, add dependencies, change domain/CRUD policy, merge main or deploy. Existing HTTP status/envelope and data-integrity guarantees remain; programmatic failure types deliberately change for unexpected failures.

## Reach and ownership

All current callers are under `src/controllers/`, `src/datastores/`, `src/models/`, and `src/server/`; validation also reaches `src/routes/resources.ts` where shared helpers are used. Read each caller before removing its catch, retain validation and cleanup, and remove now-unused imports. Convert remaining production Zod `.parse()` calls involved in this operation's input/output/configuration checks to explicit `safeParse` handling. JSON.parse is a separate operation and retains necessary malformed-JSON catches. Do not change tests' or examples' deliberate use of exported Zod `.parse()`.

The coder owns `src/` and `tests/`, including replacing obsolete assertions that unexpected failures are wrapped, and commits on the existing feature/tenants worktree. The lead owns this plan, an amendment to the tenant plan, all docs/examples and the ADR update in the separate existing tenants-docs worktree. We are not alone in the repo: preserve others' changes. Do not edit main or integrate concurrent main changes for this requested follow-up.

Update the error reference and related backend/configuration docs to distinguish explicit validation failures from unexpected failures. Supersede ADR 0020's universal normalisation policy with ADR 0025 and mark/link the old decision accordingly. Existing historical feature plans remain history; the new plan records the revised contract.

## Public tests and acceptance

The lead accepts tests at existing exported operation seams: Hedra/Collection/Config constructors, public controllers and ResourceOperations/ConfigStore, Logger methods, SQLite operations/transaction sessions, scope getters and app.request. Test schema results and observable failures, not private helpers or the presence/absence of a catch. Use isolated databases and public injected dependencies when testing propagation.

Use TDD one behaviour at a time. Reuse existing success, CRUD, data-integrity, field-validation and lifecycle coverage rather than adding duplicate tests. Update obsolete assertions only with tests of the new contract:

1. **Expected validation failures retain their explicit categories and useful issues.** Invalid collection/environment/logger/scope/input data is classified; corrupt stored/projected data is OutputValidationError. Validate ordinary tenant failures, invalid output URLs and JSON integrity without leaking ZodError for expected schema failures.
2. **Unexpected native and existing Hedra errors propagate by identity.** Cover thrown refinements/transforms and injected backend/datastore/controller failures at the exported seams. For SQLite transaction callbacks, cover native Error, an existing HedraError and a thrown primitive. None acquires a new wrapper.
3. **Unexpected HTTP failures remain safe and roll back writes.** Generated routes return exactly the generic 500 envelope without exception messages, issues, stack or tenant data, including when a model callback throws. Expected public client errors keep their status and established envelope.
4. **Rollback and connection/session ownership survive simplification.** A failing transaction leaves no partial writes, expires its session, resets state and permits a subsequent successful transaction. Failed registration releases a just-opened owned backend and leaves the collection unattached; borrowed resources stay open. App-close guards still reject saved controllers/session calls.
5. **Native storage failures preserve data and the native error.** Duplicate SQLite IDs reject without replacement; connection/open failures are no longer forcibly normalised. Known bad table names, filters, identifiers and record shapes still fail before SQL interpolation/persistence with explicit errors.

Run `bun run fmt`, `bun run check` (including coverage), every existing executable example and affected runnable error-reference snippets. Verify no helper definition, import or call remains. After the lead's acceptance, obtain an independent read-only review against this plan and the updated ADR, fix confirmed findings through the same coder and rerun affected checks. Finish with the verified commits on feature/tenants; no merge approval is requested.
