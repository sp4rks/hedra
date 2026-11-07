# Let Bun load environment files

Status: implemented and independently reviewed together with the pending Config class cleanup; awaiting approval to merge into `main`.

## Accepted scope

The user wants Bun to handle environment files and Hedra to read whatever environment variables Bun provides. Continue on the pending `feature/config-class-helpers` branch, preserving its removal of the merged interface and its private static validation/reporting methods. No merge approval has been given for this combined change.

Delete `overlayEnvFile`, its calls and the `readFileSync`/`parseEnv` imports. Stop interpreting `HEDRA_ENV_FILE` and stop applying any Hedra-specific file fallback or precedence policy. `new Config()` reads `process.env`, populated by Bun before application code runs. `new Config(environment)` reads only the supplied snapshot. Keep the environment schema, category-derived defaults and types, trimming, strict native-value decoding, Zod validation, startup reporting, class identity and app injection unchanged.

Use Bun's existing `--env-file` and `--no-env-file` flags without adding a Hedra wrapper or replacement option. `HEDRA_ENV_FILE` becomes an unused environment key, like any other unrecognized environment variable. File opening and parsing failures are Bun's responsibility. This supersedes the environment-file clauses of ADRs 0014 and 0022; record ADR 0023 and update the existing configuration reference and hello-world comment.

Bun's official environment documentation confirms automatic file loading, flag selection and `process.env`/`Bun.env` aliasing: https://bun.com/docs/runtime/environment-variables. The installed Bun help also exposes `--env-file` and `--no-env-file`. Document the runtime handoff without duplicating Bun's full version-specific file precedence rules.

## Accepted public test seams

1. **`new Config(environment)` ignores legacy file selection.** Add a regression using a real temporary file containing different values and supply its path as `HEDRA_ENV_FILE`; assert that only the supplied environment and built-in defaults affect the result. Confirm this fails before deleting the loader.
2. **Bun startup with `--no-env-file` remains respected by `new Hedra()`.** Put a setting in a temporary working directory's `.env`, disable Bun's loading and assert the app uses its built-in default. The existing manual fallback must make this test fail before implementation.
3. **`new Hedra()` consumes Bun's selected-file environment.** Migrate the existing isolated subprocess case to `bun --env-file=...`, retain explicit variable precedence and separate app/config identity checks. Remove `HEDRA_ENV_FILE` from that case.
4. **`new Hedra()` consumes Bun's automatically loaded `.env` environment.** Migrate the existing `.env` subprocess case to normal Bun startup. Also verify an explicit `Config` snapshot does not inherit ambient values.
5. **`new Config(environment)` preserves its input.** Replace the file-overlay immutability fixture with a frozen explicit environment snapshot. Reuse all existing native-value, blank/default, invalid-input, reporting, type, injection and startup-failure coverage.

Remove obsolete tests for Hedra file precedence, missing-file fallback, access errors and directory permissions. Those behaviours no longer belong to Hedra. Keep temporary paths and subprocess environments isolated, and strip inherited `HEDRA_` variables in the existing subprocess pattern. Use TDD one new behaviour at a time, then run `bun run check`.

## Ownership and acceptance

The same configured coder owns only `src/server/config.ts` and `tests/server/config.test.ts` in `.worktrees/config-class-helpers`; do not undo the prior helper/type refactor. The lead owns this plan, test boundaries, `docs/` and `examples/` updates, verification and integration. Reuse `.worktrees/config-class-helpers-docs`, advancing its docs branch to the new plan before implementation begins; documentation proceeds separately from code. Continue using the previously established house/docs-style substitute for the unavailable `user-docs` skill.

After code and docs are combined, run the required checks and exercise the documented Bun launch command. Have the same independent reviewer review the fixed combined diff against both plans and the latest user request. Leave `main` unchanged until the user approves merging the completed result.

## Verification results

- Implementation commit `174cfc0` removes Hedra's file reader, selection/fallback logic and obsolete filesystem tests. The explicit-snapshot regression failed before the fix (`from-file.example` rather than `hedra.local`); the `--no-env-file` regression also failed (`8123` rather than `3000`). Both passed after removing the loader.
- `bun run check` passed on integrated revision `e071b56`: TypeScript, Biome and 233 tests with 943 assertions. Focused coverage includes Bun-selected files, automatic `.env`, process-environment precedence, disabled file loading, isolated explicit snapshots, immutability and app identity. Integration tests ran outside the filesystem sandbox.
- The documented `bun --env-file=<app.env> examples/01-helloworld.ts` launch served `200 Hello Hedra!` at its file-configured loopback address; the temporary process and file were cleaned up.
- Independent review found no code issues and passed TypeScript, Biome and 30 tests with 126 assertions. Its one stale logging-reference sentence was corrected in documentation-only revision `2b2768c`; focused re-review confirmed no actionable findings remain in `c78145e..2b2768c`, with a ship verdict subject to merge approval. No production code changed after the full check.
- Updated documentation links and whitespace checks passed. `HEDRA_ENV_FILE` is intentionally ignored; custom file selection uses Bun's `--env-file` flag. The main checkout remains clean at `c78145e` pending approval for the combined change.
