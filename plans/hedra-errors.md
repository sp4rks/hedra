# Consistent Hedra errors

## Behaviour and scope

Every error explicitly raised by Hedra production code extends `HedraError`. Native validation, JSON,
filesystem, SQLite, logger and application-callback failures crossing Hedra-owned operations are
converted into this hierarchy. Existing Hedra errors retain their identity, status, title and detail.
Wrapped failures retain their original value as the standard, non-enumerable `cause`.

The guarantee covers Hedra configuration, collection definitions and registration, default logging,
programmatic resource operations, SQLite operations (including synchronous transaction sessions),
association operations, default REST controllers and generated routes. It does not change Zod itself:
calling an exported schema's `.parse()` directly still has Zod's native contract. Consumer code and
inherited Hono APIs likewise retain their own contracts until a failure crosses Hedra-owned code.
Tests may deliberately throw native errors to exercise these boundaries.

No change to successful results, validation rules, transaction atomicity, resource identity, connection
ownership or HTTP redaction. No dependencies, decorators, proxies or general interception framework.

## Interface and structure

Reuse the errors in `src/server/errors/errors.ts`; do not introduce a taxonomy of new subclasses.
Keep existing constructor signatures and statuses. Add only a small internal normalization helper if
needed to preserve existing Hedra errors and record causes consistently; it is not a package export.
Keep validation and catches at existing operation boundaries rather than wrapping every expression.
Use `ConfigurationError` for definition/startup failures, `InputValidationError` for invalid operation
input, `OutputValidationError` for failed output projection, and the existing datastore subclasses for
storage/connection/transaction failures. Unexpected faults can use `HedraError` with status 500.
Do not reinterpret an existing Hedra error based on the outer operation.

Affected production areas: `src/server`, `src/models`, `src/datastores`, `src/controllers`, and
`src/routes`. Check all callers of changed helpers and preserve their error handling. Schemas and
package exports stay otherwise unchanged. Documentation lives in existing `docs/errors.md`,
`docs/backends.md` and related references where existing native-error claims need correction.
An ADR records the change from documented native SQLite errors to normalized Hedra errors.

## Accepted test seams and cases

The lead accepts the following public seams. Implement one failing regression and minimal fix at a
time, reusing existing tests where they already exercise the failure. Assert the actual error class,
retained cause/identity where relevant, and observable rollback or unchanged storage.

| Public seam | Named behaviours and failure paths |
| --- | --- |
| Existing error classes | Constructors keep their signatures/status/detail; normalized failures retain a non-enumerable cause; existing Hedra errors retain identity. |
| `Config` | Invalid environment data and unreadable env files throw `ConfigurationError`; missing optional files keep working. |
| `Collection`, `Hedra.register`, collection controller access | Invalid names/models/options, unsupported embedded definitions, duplicate/reserved/cyclic registration and unattached/closed access all throw a Hedra error. Failing custom controller construction retains its cause and registration remains retryable. |
| `Logger` construction and methods | Invalid bindings/fields become Hedra errors without relaxing field validation; supplied logging failures are normalized where called by Hedra. |
| `SqliteBackend` constructor and CRUD | Invalid table/record/filter and JSON input, failed open, duplicate keys, closed connection and modifier failures throw Hedra errors; failed writes keep prior records. |
| `SqliteBackend.transaction` and its session | Native and non-Error callback failures are normalized; Hedra callback errors retain identity; nested/async/expired sessions fail with Hedra errors and writes roll back. A caught session operation failure is already a Hedra error. |
| `ResourceOperations` / `ConfigStore.tenants` | Invalid UUID/managed metadata/filter/JSON input and borrowed backend rejection become Hedra errors; valid CRUD still works. |
| `BaseController`, association operations and scope getters | Invalid direct arguments, bad scopes, projection/identity failures and injected backend errors become Hedra errors. Projection failures still prevent commits. |
| Generated routes via `app.request` | Existing 400/404/409/415/422 results and redacted 500 responses remain intact. |

Run `bun run check`, all existing executable examples and a production throw-site audit. The independent
reviewer checks the complete fixed commit range against this plan and the docs before acceptance.

## Workflow

Implementation is delegated to the configured coder in `.worktrees/hedra-errors` on
`feature/hedra-errors`; the lead owns design, acceptance and docs. Documentation is prepared on a
separate `feature/hedra-errors-docs` branch/worktree while implementation runs, then merged into the
feature branch before checks and independent review. The referenced `user-docs` skill is not installed;
use the available documentation style and Diátaxis instructions, and include newcomer clarity in the
required independent review. `README.md` is absent from the starting checkout; existing ADRs and
references supply the applicable contracts. Merge to `main` only after explicit user approval.
