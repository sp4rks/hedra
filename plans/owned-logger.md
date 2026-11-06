# Give Hedra one owned logger

The intended deployment has one Hedra app and one logger. Shared parent loggers and contextual children were unnecessary flexibility. Each app creates its logger once, binding its instance ID during construction, and passes that logger to controllers that need it.

Configuration is validated when `Config` loads it. Hedra and its logging consumers use that loaded configuration directly.

## Behaviour and public interface

- Remove `child` from `Logger` and from the Pino implementation. Keep the six message-first level methods and optional per-call `LogFields` unchanged.
- Remove the `logger` dependency from `HedraOptions`; retain `config` and `backend`. Do not replace it with a logger factory option, wrapper or global singleton. Unknown options retain their ordinary runtime handling, while fresh TypeScript literals with `logger` are no longer valid.
- Change the public factory to `createLogger(config: Config, bindings?: LogFields): Logger`. It always constructs the implementation selected by the loaded configuration. It no longer accepts or returns a supplied logger.
- Server setup uses `createLogger(config, { instanceId: this.instanceId })`, without a child call or implementation-specific code. Instance IDs remain app-owned and bound to every app log record.
- Preserve `new PinoLogger(config, destination?)` and add optional constructor bindings as a third argument: `new PinoLogger(config, destination?, bindings?)`. The generic factory passes bindings to that implementation. Validate and copy initial fields before opening the output stream. Merge initial and per-call fields into one record, with per-call fields retaining their existing precedence and no duplicate application field keys.
- With no child method, merge the private `PinoAdapter` into the public `PinoLogger` class. Keep native Pino private. Preserve all six levels, filtering, silence, JSON/pretty output, error serialization, destination ownership and structured-field validation.
- `HEDRA_SERVER_LOG_LIBRARY` remains the selector, with `pino` as default and only accepted value. Loading rejects invalid settings before a Config can be supplied to consumers. Environment loading, supplied Config identity, backend ownership and routing do not change.
- Remove `validateConfig` imports and calls from Hedra, `createLogger` and `PinoLogger`. The existing `Config` constructor already parses environment input, resolves files/defaults, validates native values and stores the parsed output before reporting success. Preserve that load boundary and its variable-specific errors. Consumers read properties directly, without extra parsed copies, validation wrappers, freezing, branding or option checks.
- Supplied Config instances are trusted loaded dependencies. Subclasses supply alternate built-in settings through `super(environment)` and may add their own fields; built-in field overrides or mutations after loading are unsupported and are not revalidated. Do not preserve consumer checks for deliberately corrupted or incomplete instances. Structured log fields still require their existing validation.

## Structure and ownership

Keep `logging.ts` as the generic interface/schema, `create-logger.ts` as the configured constructor and `pino.ts` as the single concrete implementation. No new production modules, types, options, dependencies or helpers are needed.

The coder owns `src/server/logging/`, `src/server/server.ts`, any necessary configuration-module adjustment and affected tests. The lead owns this plan and documentation in a separate `feature/owned-logger-docs` worktree. Update the logging/configuration references and record ADR 0016, superseding the contextual-child and supplied-logger clauses of ADRs 0005, 0013, 0014 and 0015. Record ADR 0017 for validation at load time, superseding their consumer-revalidation clauses while preserving ADR 0004's Config-owned resolution and additional subclass state. Keep other decisions and historical feature plans intact. The controller example already accepts the app's logger directly and should continue working without changes.

## Test design and acceptance

The lead accepts the package's `Logger` and `HedraOptions` types, factory output, direct `PinoLogger` output through a writable destination, and Hedra subprocess output as public seams. Avoid internal mocks, process-global environment mutation and source-code assertions.

1. `Logger has no child method` and `HedraOptions has no logger option`: type assertions fail against the old exported contracts before implementation.
2. `createLogger binds initial context during creation`: a public factory/output test with `{ instanceId: 'test-instance' }` fails against the old supplied-logger signature, then verifies the bound field appears on output. Retain factory default and explicit library/format/level tests.
3. `PinoLogger retains initial context across log levels and per-call fields override bindings`: reuse the existing level/output tests and replace child-specific coverage with constructor-binding coverage. Verify no duplicate application field keys, initial-field copying and invalid bindings/per-call fields failing without output. Do not introduce a hierarchy of contexts.
4. `Hedra creates its logger with its instance ID`: retain the existing environment-driven subprocess test, supplied Config identity and independent app identity. Remove the RecordingLogger/shared-parent/callable-injection fixtures and tests for the retired injection API.
5. Preserve collection registration logging/filtering through existing subprocess coverage in `tests/server/hedra.test.ts`; remove the duplicate injection-based test instead of building a replacement injection seam. Retain invalid configuration failure before logging/listening/SQLite through existing startup tests.
6. Reuse the existing Config tests for invalid environment values, library/format/level, files, defaults and success-report suppression. Move remaining invalid-setting assertions to Config construction and remove tests for consumer rejection of corrupted/incomplete instances. Express valid subclass settings through `super(environment)` and retain additional subclass state and supplied object identity. This responsibility refactor preserves behaviour for supported loaded Config inputs; do not add tests for private validation-call counts, source text or acceptance of corrupted data merely to manufacture a red test.

Follow TDD in vertical slices, with intended red evidence before implementation. Run focused logging/config/startup tests, `bun run check`, the updated documentation examples and the controller example. The lead reviews the combined immutable range with the independent reviewer before integration. The baseline at `2e83f0d` has a known unrelated closed-connection message assertion failure; leave it untouched and distinguish it from regressions.

The lead accepts this simplification and these test boundaries within the user's approval to give Hedra an owned logger. Merge to `main` only after the user approves this feature.
