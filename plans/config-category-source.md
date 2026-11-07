# Category definitions as configuration's single source of truth

Status: implemented and independently reviewed; awaiting user approval to merge into `main`.

## Scope and accepted design

Each setting is defined once in `src/server/configs/deployment.ts` or `src/server/configs/server.ts`. Its entry supplies the environment-variable key, resolved property name, default, metadata and Zod schema. The merged definitions drive environment loading, the complete values schema, parsed output types and the readonly properties on `new Config()`.

Preserve the public constructor, direct property access, subclass support and dependency identity. Keep native numbers and booleans, exact enum types, strict validation, error messages, startup reporting and environment/file/default precedence. Keep validation during loading as specified by ADRs 0004, 0014 and 0017. Add no settings, dependencies, broad index signature, runtime extension interface or configuration-provider abstraction.

## Structure and implementation

- Keep the existing files and their responsibilities. Category modules preserve literal property names while satisfying the existing definition contract.
- Merge the category dictionaries without widening them to `ConfigDefinitions`. Derive a schema shape keyed by each entry's `name` with that entry's precise Zod schema type.
- Construct `ConfigValues` from the entries with `Object.fromEntries` and `z.object`. If TypeScript needs an assertion for the generated shape, keep it local to that construction and derive its target from the entries rather than writing a parallel property list.
- Keep `ConfigValues`' output type inferred from Zod. Derive the `Config` instance properties through an interface extending `Readonly<ConfigValues>` merged with the existing class. Remove the manual values-schema map and per-property class declarations.
- Preserve the constructor's resolution and error-handling logic. No caller, fixture, package export or configuration migration is required. Existing callers in Hedra, Logger, controllers, datastores and examples continue using the same properties.

The category dictionary is trusted, statically maintained source code. Do not add duplicate-name detection or runtime validation of those definitions. Application values still cross the existing Zod validation seam.

The lead accepts this design against the user's explicit request. ADR 0021 will supersede ADR 0004's per-property declaration detail while retaining its direct-property class design. Other loading and validation decisions remain in force.

## Test design and acceptance

The lead accepts these existing public seams. Implementation uses the TDD skill without adding an implementation-specific test interface.

1. **`new Config(environment)` resolves a setting declared only in a category.** Before implementation, temporarily add a numeric probe entry to an existing category and a public-constructor acceptance test that expects its literal default and explicit override. Confirm that the current implementation fails because the manual schema omits the property. After implementation, the same entry and test must pass without editing the loader, values schema or class. Remove the temporary probe entry and test before committing: no new product setting is requested.
2. **`new Config(environment)` validates that category-only setting.** In the same temporary acceptance experiment, assert that an out-of-range probe throws `ConfigurationError` naming its environment variable. Confirm the test passes with the derived schema.
3. **The public `Config` type exposes that category-only setting as a readonly number.** In the temporary probe, check the exact property and readonly `Pick` types through the exported class; the old implementation must fail type checking and the new one must pass. Remove probe assertions with the temporary entry.
4. **`Config` preserves precise readonly native and enum property types.** Extend the existing permanent type checks in `tests/server/config-class.test.ts` for server environment, log format and log level, and assert that `string` is not a key of `Config`. Existing number, boolean, readonly and library-literal checks remain.
5. **Existing constructor, application and subprocess seams preserve behaviour.** Reuse the existing tests for defaults and overrides, blank values, strict booleans, invalid settings and error details, source reporting, environment files, caller identity, subclasses, startup failure and downstream consumers. Do not duplicate them or inspect generated schema internals.

The temporary category-only experiment is the red/green proof of this structural change. Existing runtime tests and permanent public type assertions guard behaviour afterward. Run `bun run check`; report every failure or skipped platform check. The lead will also run the affected documented constructor examples and repeat the category-only acceptance experiment before accepting the work.

## Ownership and workflow

- The lead owns this plan, test boundaries, documentation, ADRs and acceptance.
- The configured coder owns `src/server/config.ts`, `src/server/configs/deployment.ts`, `src/server/configs/server.ts` and `tests/server/config-class.test.ts` on `feature/config-category-source` in `.worktrees/config-category-source`. Any temporary acceptance fixture must be cleaned up before committing.
- The lead updates only `docs/` on `feature/config-category-source-docs` in its own worktree while implementation proceeds. Document derivation in the existing configuration reference and record ADR 0021, including a supersession link from ADR 0004. The referenced `user-docs` skill is unavailable; use house documentation standards, docs-style and an independent newcomer review instead.
- After implementation, merge the documentation branch into the feature branch, run checks and documented examples, then obtain one independent read-only review of the fixed range against this plan. Confirmed findings go back to the same coder and receive focused verification and review.
- Keep `main` unchanged until the user explicitly approves merging the completed, reviewed branch.

## Verification results

- Implementation commit `dff5399` removes both manual property lists, preserves literal names in category definitions and adds the agreed public enum/no-index type assertions. Documentation was integrated as `d16a182`.
- The coder's temporary numeric category-only probe failed before implementation: its default was absent, invalid input was accepted and its readonly property type was missing. After implementation it passed for default `17`, trimmed override `23`, named validation errors and the exact readonly number type. The temporary entry and tests were removed before committing.
- `bun run check` passed on `d16a182`: TypeScript, Biome and 238 tests with 948 assertions. Loopback networking and subprocess execution required running the integration check outside the filesystem sandbox; that complete run passed.
- The lead independently added only a numeric category entry in a disposable source copy. TypeScript and two public constructor tests passed for default `7`, trimmed override `12`, invalid `0` with its environment-variable name and the readonly number type. No test-only setting remains in the feature branch.
- Documented `Config` construction and Hedra injection passed. The changed reference/ADR links resolve, and `git diff --check` passed.
- Independent read-only review of `7a4f21f..d16a182` returned no actionable findings and a ship verdict, including the documentation newcomer pass. The reviewer independently passed TypeScript, Biome on the four changed code/test files, 11 tests with 24 assertions and the documented constructor/injection usage. The local generated-shape assertion and class/interface lint suppression were accepted against the constructor's complete parsed-value assignment.
- The main checkout remains clean at `7a4f21f`. Runtime freezing and live configuration mutation remain outside the supported interface; readonly is enforced by TypeScript as before.
