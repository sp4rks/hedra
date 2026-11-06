# Plain application constructor options

`HedraOptions` is routine application wiring. Replace its internal Zod schema and inferred type with a plain exported TypeScript type containing the same optional `env`, `config`, `logger` and `backend` properties. Keep the existing package type export and caller syntax.

Remove the options-only environment, logger and backend validators, including validation of the logger's child. Use the supplied dependencies directly. Retain an explicit runtime check rejecting simultaneous defined `env` and `config` values with the existing message. Retain `new Config(env)` and `validateConfig(config)` so environment input, resolved settings and subclass overrides remain validated before logger initialization or database access. Preserve supplied configuration identity and per-app logger bindings.

Unknown constructor properties are ignored at runtime. Malformed logger/backend implementations and `Config` instance identity are no longer checked by the constructor's options schema; callers must satisfy the exported TypeScript contracts. Configuration values remain validated. No dependencies, runtime changes, storage changes or unrelated cleanup are included.

## Coding standard and documentation

Use Zod for "in plane" object definitions: models of data the application works with, including resources, embedded resources, associations, configuration values and transport/storage data. Derive their types from schemas and preserve trust-boundary validation. Plain TypeScript types and interfaces are appropriate for routine options and dependency wiring such as `HedraOptions`, `Logger` and `Backend`; they do not require a schema solely to describe their shape.

Update `CODING_STYLE.md` and the constructor reference in `docs/configuration.md`. Record this lasting distinction in an ADR. Prior feature plans remain historical records of their original scope; this plan and ADR document the replacement decision. No glossary terminology or example API changes are needed.

## Test design and acceptance

The lead accepts the existing public `new Hedra(options)` seam and package type export as the test boundaries. Do not test private schemas or helpers.

- `Hedra accepts options from a wider application object`: pass a correctly typed options variable with an extra application property and verify construction/configuration succeeds. This must fail on the old strict schema before implementation, then pass.
- `Hedra rejects conflicting configuration sources`: preserve the existing `env`/`config` rejection, including its message.
- `Hedra validates supplied environment values`: preserve malformed environment rejection through `Config` and cover an invalid setting producing `ConfigurationError`.
- Retain existing valid dependency injection, configuration identity, callable logger, per-app identity and supplied invalid/incomplete `Config` subclass regressions. The invalid subclass test must continue proving the logger is untouched and SQLite is not opened.
- Remove tests requiring unknown-key, malformed logger/backend and malformed child rejection. Do not replace them with tests promising support for invalid dependencies.
- Run `bun run check`, execute relevant configuration/logging examples, and obtain one independent read-only review of the fixed implementation and documentation range. Main remains unchanged until the user approves merging.

The coder owns `src/server/server.ts` and `tests/server/hedra-options.test.ts`. The lead owns this plan, `CODING_STYLE.md` and documentation. Implementation and documentation use separate branches/worktrees.
