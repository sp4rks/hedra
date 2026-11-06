# Load the application environment through Config

Hedra loads its environment itself. `env` is a redundant shortcut for constructing the configuration dependency and creates a competing input that the constructor has to reject. Remove it from `HedraOptions` and let the default `new Config()` resolve `process.env`, selected environment files and configuration defaults.

## Behaviour and interface

- `new Hedra()` creates its configuration through `new Config()` without passing an environment argument.
- `HedraOptions` remains a plain exported type with optional `config`, `logger` and `backend` dependencies. Remove its `env` property and the `env`/`config` conflict check.
- `new Hedra({ config })` retains the supplied instance, including subclasses. Configuration is validated before logger initialization or database access. Resolve the configuration once and validate it consistently, removing the conditional validation branch.
- `Config(env)` remains available for deterministic tests and explicit configuration construction. Its environment parsing, file precedence, defaults and validation do not change.
- Unknown option properties remain ignored at runtime, including an `env` property arriving through a wider application object. A fresh TypeScript options literal containing `env` is no longer valid.
- Logger selection, app identity, listening addresses, route registration and backend ownership retain their existing behaviour. Do not add a factory, wrapper, compatibility option, dependency or configuration setting.

This replaces the environment-option clause of ADR 0013, while retaining that ADR's application-model and routine-wiring distinction. Record the revised ownership in ADR 0014. Existing feature plans remain historical records.

## Structure and ownership

The coder owns `src/server/server.ts` and affected files under `tests/`. Replace test calls using `new Hedra({ env: testEnv })` with explicit `Config(testEnv)` dependencies. Keep subprocess environment controls on `Bun.spawnSync`; those configure a process and are unrelated to Hedra options. Do not change `Config`, logging or backend implementations.

The lead owns this plan, `docs/configuration.md` and the new ADR. Documentation uses a separate `feature/automatic-environment-docs` worktree. No glossary terms or application examples need changes: existing examples already construct Hedra without an environment argument.

## Test design and acceptance

The lead accepts `HedraOptions` at the package type export, `new Hedra(options)` and observable subprocess startup as the public test seams. Keep tests at those seams and avoid mutating the shared process environment.

1. `HedraOptions has no environment option`: a type assertion verifies that `env` is absent. Confirm the assertion fails during type checking before implementation.
2. `Hedra retains supplied configuration when a wider options object includes env`: exercise ordinary unknown-property handling, retain supplied Config identity and verify its configured port. This must fail on the old conflict check before implementation, then pass.
3. `Hedra loads its ambient environment and selected file without options`: exercise `new Hedra()` in an isolated subprocess with process environment values and a selected file; assert native port/IP values and environment-over-file precedence. Reuse existing startup and file-fallback coverage rather than duplicating it.
4. `Hedra rejects an invalid ambient setting before startup side effects`: use an isolated subprocess with an invalid setting and verify configuration failure. Preserve existing invalid/incomplete supplied Config subclass tests proving that logger initialization and SQLite access do not occur.
5. Migrate existing deterministic Hedra tests to supplied Config instances. Keep malformed environment validation at the Config seam, and retain callable custom loggers, shared configuration identity, app isolation, runtime unknown-property handling and backend lifecycle coverage.

Follow TDD in vertical slices, recording the intended red failure before making each behaviour pass. Run focused tests, `bun run check`, and the configuration/logging documentation examples, then obtain the configured independent read-only review of the combined immutable range. The baseline at `fe1deef` has a known unrelated closed-connection message mismatch in `tests/server/hedra.test.ts`; leave it untouched and distinguish it from regressions if it persists.

The lead accepts the requested behaviour and these test boundaries. No further design or test-plan sign-off is needed. Merge to `main` only after the user approves this feature.
