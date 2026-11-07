# Keep configuration loading inside its concrete class

Status: implemented and independently reviewed; awaiting user approval to merge into `main`.

The environment-file portion of this plan is superseded by [Bun-owned environment loading](bun-environment.md): `overlayEnvFile` is removed, while validation and reporting remain private static methods. The combined branch retains the interface removal and constructor typing described below.

## Accepted scope and design

The user requested removing the merged `Config` interface and making `printConfigHeader`, `overlayEnvFile` and `validateConfig` class functions. Category definitions remain the single source of truth, with Zod validation, native values, exact readonly types and `new Config()` retained.

Use an inferred `Config` type alias (`Readonly<ConfigValues>`) and a named class expression exported as the `Config` constructor. A local constructor type assertion connects the constructor's complete `Object.assign` initialization to the schema-derived instance type. TypeScript cannot prove those dynamically assigned fields, so this assertion passes through `unknown`; a local comment records the constructor's complete parsed-value assignment. Do not introduce a base class, wrapper, factory API, proxy, broad index signature or manual property list. Preserve runtime class identity and constructor behaviour. Keep the helpers private and static, including the companion `printConfigRow`, which has the same reporting responsibility. Calls inside construction refer to the named class itself. Remove the interface and its Biome suppression.

This changes ADR 0021's interface-merging detail. ADR 0022 supersedes that detail and records the constructor's type assertion, retaining single-source definitions and the loading/validation decisions of ADRs 0014 and 0017. Removing the interface introduces no new extension contract or configuration mechanism.

## Accepted test boundaries

- The existing exported `new Config(environment)` seam covers native defaults, overrides, strict validation, error details, reporting, silent startup and env-file precedence/error handling. Reuse that coverage without testing private helpers.
- Keep the existing public type assertions for readonly numbers/booleans, enum literals and no broad string index; also check the type of an instance from `new Config()` so the constructor assertion cannot hide a widened instance type.
- Preserve the existing app injection and runtime subclass regression coverage as compatibility checks; add no subclass extension features.
- The module-only exported `validateConfig` helper becomes private. Remove its internal direct-call test and import; malformed environment input is already covered through the constructor. Retain the generic error fallback inside the method without exposing a test-only interface.
- This is a structural refactor, so existing behavioural tests are its initial baseline; do not invent a failing runtime behaviour. Run baseline focused config tests before editing, add the public constructor type assertion before implementation and run the required full `bun run check` afterward.
- The lead repeats a category-only setting/type acceptance check in a disposable copy and the documented construction/injection example. Independent read-only review checks the fixed diff, constructor assertion and documentation.

## Ownership and completion

The lead owns design, this brief, test boundaries, documentation and acceptance. The configured coder owns `src/server/config.ts`, `tests/server/config.test.ts` and `tests/server/config-class.test.ts` in `.worktrees/config-class-helpers`. No other production callers require changes: the only standalone helper caller outside this module is its direct internal test. The lead updates `docs/` on a separate `feature/config-class-helpers-docs` branch/worktree while implementation proceeds, using the previously established house/docs-style substitute for the unavailable `user-docs` skill.

After implementation, merge docs into the feature branch, verify the result and request the configured reviewer. Any confirmed findings return to the same coder. Leave `main` unchanged until the user approves this completed change.

## Verification results

- The focused configuration baseline passed before editing: 35 tests and 131 assertions. Implementation commit `da8b48e` preserves the constructor's runtime identity and exact inferred readonly types, moves all four helpers into private static methods and removes the interface/lint suppression. The single direct test of the now-private validation helper was removed; constructor validation coverage remains.
- `bun run check` passed on integrated code/docs revision `b45f779`: TypeScript, Biome and 237 tests with 948 assertions. Existing loopback/subprocess tests ran outside the filesystem sandbox.
- The lead independently added only a numeric category entry in a disposable source copy. TypeScript and two constructor tests passed default `7`, trimmed override `12`, invalid `0` with the environment-variable name, runtime class identity and an exact readonly number instance property. No temporary setting was committed.
- Documented construction, Hedra injection and runtime class identity passed. Updated documentation links resolve and `git diff --check` passed.
- Independent read-only review of `c78145e..b45f779` found no actionable issues, including the local constructor assertion, static helper moves and documentation newcomer pass. The reviewer independently passed TypeScript, Biome, 11 tests with 26 assertions and the documented construction/injection/identity example.
- `main` remains unchanged at `c78145e` until merge approval. The constructor assertion describes dynamically assigned fields; runtime construction tests cover that initialization, while readonly remains a TypeScript guarantee.
