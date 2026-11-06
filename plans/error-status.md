# Error classes own their status

Remove the status argument from every constructor in `src/server/errors/errors.ts`, including `HedraError` and `DatastoreError`. Error classes select their existing status internally. Keep class names, inheritance, default titles, custom titles, optional string/object details, `Error.message` and instance names unchanged.

`HedraError` accepts `(title: string, detail?: string | object)` and initializes status to 500. Every other class accepts `(title?: string, detail?: string | object)` with its existing default title. Classes with a status other than 500 override the instance field: input validation 422, failed precondition 412, bad request 400, unique violation 409, constraint violation 400 and missing record 404. Other classes inherit 500. Keep the existing writable status property; this change removes constructor configuration rather than adding runtime immutability.

This is an intentional constructor compatibility change: callers remove their first numeric argument. Update both configuration failure paths and all four closed-app guard operations. Preserve the latest uncommitted removal of the insert error's detail in the main checkout, and update its stale regression assertion. Do not restore that detail. No public exports, error serialization, runtime validation, configuration, dependencies or storage changes are needed. This reversible constructor simplification needs no ADR and contradicts no existing ADR.

## Structure and ownership

The lead owns this plan, public test boundaries, documentation and acceptance. The configured coder owns `src/server/errors/errors.ts`, the affected callers in `src/server/config/config.ts` and `src/server/server.ts`, `tests/server/errors.test.ts`, and narrowly scoped assertions in the existing configuration and lifecycle tests. Implementation stays on `feature/error-status` in `.worktrees/error-status`.

The lead writes `docs/errors.md` and a related link from the configuration reference on `feature/error-status-docs` in `.worktrees/error-status-docs`, touching only `docs/`. The referenced user-docs skill is not installed; use the available docs-style skill and existing reference conventions, verify its example from the repository root, and include the docs in independent review.

## Lead-owned test design

Use TDD through exported constructors from `#errors`, exported configuration validation and `Hedra.request`. Do not test private guards.

- `HedraError uses status 500 and preserves its title and detail`: cover base construction, Error identity, name and message.
- `Each error class supplies its fixed status and existing default title`: table-test all twelve subclasses, including the DatastoreError base class, and retain the Error/HedraError/DatastoreError inheritance contracts.
- `Each error class accepts a custom title and optional detail without a status argument`: exercise custom titles, omitted details, string details and object details without changing their values.
- `Error constructor types accept only title and optional detail`: check all exported constructor parameter types with existing Bun type assertions so a numeric status argument cannot remain accepted.
- `Config preserves its configuration error status, title and variable detail`: strengthen the existing invalid-domain assertion. Cover the generic `validateConfig(null)` failure's status, title and detail as well.
- `Hedra.close rejects every saved controller operation with status 500`: reuse the current create/id/list/update/delete route test and assert the user-selected absence of insert detail. Keep borrowed backend and other-app access coverage.

Work in vertical slices: demonstrate red on the changed constructor contract before implementation, then implement minimally and rerun. Existing controller tests continue covering 404 absence behavior. Run `bun run check` and the docs example after merging docs. Known baseline: three spacing lint failures in unchanged `src/datastores/backend.ts`; do not broaden the change to fix them. If they still stop the full check, run the full test suite and scoped formatter checks separately and report them accurately.

After acceptance, obtain one independent read-only review of the fixed commit range against this plan and docs. Fix confirmed findings through the same coder. Merge to main only after the user approves this change.
