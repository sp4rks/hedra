# Construct the default logger through a class

Replace `createLogger` with a public `Logger` class, following the existing interface and default implementation pattern. The user also approved supplying a custom logger to Hedra, as with configuration. Keep the six message-first logging methods and existing Pino behaviour.

## Behaviour and public interface

- Export `LoggerInterface` with `trace`, `debug`, `info`, `warn`, `error` and `fatal`, each accepting a message and optional `LogFields` and returning `void`. Generic consumers, including `app.log`, depend on this interface, without private class members or Pino types.
- Rename the existing Pino implementation to `Logger implements LoggerInterface`. Its constructor is `new Logger(config?: Config, destination?: Writable, bindings?: LogFields)`, defaulting to `new Config()` when configuration is omitted. Preserve the existing Pino constructor argument order, structured-field validation and copying, JSON/pretty formatting, levels, filtering, silence, error serialization and stream ownership.
- Remove the `createLogger` factory and `PinoLogger` export. Migrate factory callers to `new Logger(config, undefined, bindings)` and Pino callers to `new Logger(config, destination, bindings)`. Type-only consumers migrate from `Logger` to `LoggerInterface`.
- Add `logger?: LoggerInterface` to `HedraOptions`. Retain the supplied logger instance without wrapping or mutation. Otherwise construct `new Logger(config, undefined, { instanceId: this.instanceId })`. Each default app logger keeps its independent instance identity. Custom loggers control their own context, fields, destination and lifetime; Hedra does not add instance fields or close them.
- Config loading remains unchanged, before default logger construction. `HEDRA_SERVER_LOG_LIBRARY` still defaults to and accepts only `pino`; unsupported values still fail Config loading. A replacement logger is selected explicitly through `HedraOptions`, without a registry, another backend or another configuration option.
- Keep contextual children removed and preserve backend, routing and app-close behaviour. Supplied dependencies remain trusted TypeScript contracts, without runtime method checks or additional Config validation.

## Structure, trade-offs and ownership

```text
src/server/logging/
  logging.ts   Library-independent LoggerInterface and LogFields schema/type
  logger.ts    Default Logger class using Pino privately
```

Delete `create-logger.ts` and rename `pino.ts` to `logger.ts`; construct the only supported default implementation directly. This avoids adding a forwarding class solely to hide the existing Pino class. A custom implementation needs only the public interface, not inheritance from a class with private Pino members.

The coder owns `src/server/logging/`, `src/server/server.ts`, `src/hedra.ts`, affected tests and the terminology corrections in `CODING_STYLE.md`. The lead owns this plan, `docs/` and `examples/` on a separate `feature/logger-class-docs` branch/worktree. Update the controller example, logging/configuration references and ADR 0018 to supersede the factory and injection restrictions of ADRs 0015 and 0016. Preserve historical plans. The repository references a `user-docs` skill that is unavailable in the installed skill directories; apply the available docs-style and Diátaxis guidance and include a newcomer-focused documentation check in the independent review.

## Test design and acceptance

The lead accepts the package exports/types, constructor output through a public writable destination or an isolated subprocess, and Hedra's supplied dependency and observable registration logging as public seams. Follow the TDD skill in vertical slices, recording intended red evidence before implementation. Do not inspect private Pino objects or mock internal modules.

1. `Logger constructs without arguments from the process environment`: isolated subprocess with silent Config startup verifies `new Logger()` emits JSON/info output and filters debug output. This fails against the existing type-only Logger export.
2. `Logger binds initial context during construction` and `Logger honors explicit library, format and level settings`: migrate existing factory output coverage to the class constructor. Existing Config coverage retains unsupported-library errors and validation before startup side effects.
3. `Logger emits message-first structured JSON`, `Logger emits each level and filters below the configured threshold`, `Logger writes nothing at silent level`, `Logger writes a readable line in pretty format`, `Logger copies initial context and per-call fields take precedence`, `Logger preserves error messages and stacks`, and `Logger rejects structured fields that are not a string-keyed record`: migrate the existing Pino tests, preserving all meaningful assertions including invalid null/array bindings and invalid per-call fields causing no output.
4. `Hedra retains a custom LoggerInterface and uses it for collection registration`: supply a non-Pino implementation through the public option, assert reference identity and observable registration logging. Verify it is not mutated or closed and does not need `child` or any Pino-specific API. Retain default app-identity output and independent default logger tests.
5. Update the option type assertions to accept `logger` and preserve the absence of `child`. Replace the retired-logger unknown-option fixture with a genuinely unknown property. Assert the default Logger satisfies LoggerInterface and that a custom implementation is assignable without extending Logger.
6. Exercise the updated controller example and logging documentation examples, including a replacement logger and a writable destination. No changes to Config schema, fixtures, dependencies or package configuration are needed.

Run focused logging/config/startup checks, `bun run check` and the documentation examples. The baseline at `bc48205` passes types/formatting/lint and has 214 passing tests plus one existing unrelated failure: `Hedra.close invalidates saved controller references without closing a borrowed backend` expects `Hedra is closed` but receives `Datastore connection is closed`. Leave that failure untouched and report it separately. Tests opening local listeners require execution outside the restricted networking sandbox.

The lead accepts this design and these test boundaries within the user's request and explicit custom-logger approval. Merge documentation into the feature branch, inspect the final immutable range, and obtain one independent read-only review using the configured reviewer before acceptance. Merge into `main` only after the user approves the completed change.
