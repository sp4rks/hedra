# Select the logging library through configuration

Hedra's server must depend on its generic logging contract, with no Pino imports, names or selection logic. Keep the existing `Logger` interface and isolate its Pino implementation. Select the implementation through validated environment configuration, with Pino as the default and only accepted library.

## Behaviour and public interface

- Add `HEDRA_SERVER_LOG_LIBRARY`, exposed as the read-only `Config.serverLogLibrary`, with default `pino` and schema `z.enum(['pino'])`. Use the existing configuration definitions, environment trimming, file precedence, defaults, startup report and error reporting. Unset or blank values use the default; unsupported library names produce a `ConfigurationError` identifying this variable.
- Keep `HEDRA_SERVER_LOG_FORMAT` and `HEDRA_SERVER_LOG_LEVEL` independent. `pretty` is an output format and is not a library name. Do not revive `HEDRA_SERVER_LOG_TYPE`.
- Keep the public `Logger` interface and `LogFields` type unchanged: message-first level methods, structured fields and independent contextual children, with no library-specific methods or types.
- Export `createLogger(config: Config, logger?: Logger): Logger` from the package entry point. Validate the configuration, retain a supplied logger when present, otherwise select the implementation by `serverLogLibrary`. A simple switch with a `pino` case is sufficient. No fallback literals, plugin registry or dynamic imports from environment values.
- Hedra calls `createLogger(config, options.logger)` and binds `instanceId` through the generic `child` interface. Configuration validation still precedes logger or SQLite side effects. Preserve custom/callable logger injection, configuration identity and parent/sibling isolation.
- Keep the public `new PinoLogger(config, destination?)` constructor and all existing output behaviour. Remove its backend-selection static `create` method and migrate callers to `createLogger`.

## Structure and ownership

```text
src/server/logging/
  logging.ts        Generic Logger interface and LogFields schema/type
  create-logger.ts  Config-driven selection returning Logger
  pino.ts           Existing Pino implementation and private adapter
```

Keep the generic contract independent of Pino imports. The factory imports the contract and implementation, and the implementation imports the contract, avoiding a runtime import cycle. Export the LogFields schema from its internal module for adapter validation; retain the package's existing type-only LogFields export. The package exports `createLogger` and keeps `PinoLogger` exported from its new module.

The coder owns `src/server/logging/`, the relevant configuration definitions/properties, `src/server/server.ts`, `src/hedra.ts` and affected tests. The lead owns this plan and documentation on a separate `feature/logger-library-docs` branch/worktree. Update `docs/logging.md`, `docs/configuration.md` and a short ADR 0015 extending ADR 0005 with configuration-driven library selection. Existing feature plans remain historical records. No new glossary terms, dependencies, deployment configuration, runtime APIs or unrelated changes are needed.

## Test design and acceptance

The lead accepts `Config`, package exports, `createLogger`, `new PinoLogger` with a writable destination and `new Hedra()` with observable subprocess output as public seams. Avoid inspecting private native Pino objects or mocking internal implementation details.

1. `Config defaults its logging library to pino`: cover unset/blank settings and the precisely typed read-only property.
2. `Config accepts an explicit pino library and rejects unsupported libraries`: cover trimming, invalid values such as `pretty` and an unknown name, and variable-specific ConfigurationError details. Confirm the new setting fails its intended test before implementation.
3. `createLogger emits configured default JSON/info output` and `createLogger honors explicit pretty/warn settings`: migrate existing factory-output tests to the generic factory, explicitly exercising library selection. Confirm the missing factory produces the expected red failure before implementation.
4. `createLogger preserves a supplied Logger`: migrate the existing supplied-logger identity test and retain callable logger, app-bound child, parent/sibling isolation and supplied invalid/incomplete configuration tests. Verify an invalid library cannot bypass validation through a supplied logger or invalid Config subclass.
5. `Hedra selects its logger library from the environment`: use an isolated subprocess with `HEDRA_SERVER_LOG_LIBRARY=pino`, observe a structured app log with its instance ID, and verify unsupported library startup fails without logger/database side effects. Reuse existing process-environment and startup patterns without mutating shared process.env.
6. Retain existing direct Pino constructor tests for every level, filtering, silent/pretty output, error serialization, independent fields and invalid input. Mechanical code moves must preserve those behaviours.

Follow TDD in vertical slices and record red evidence. Run focused config/logging/startup tests, `bun run check` and the updated documentation examples. The lead verifies that `src/server/server.ts` and the generic contract contain no Pino references, then obtains the configured independent read-only review of the combined immutable range. The baseline at `5a139a1` contains the known unrelated closed-connection message mismatch; leave it untouched and distinguish it from regressions if it persists.

The lead accepts this design and these test boundaries within the user's requested scope and chosen LIBRARY terminology. Merge into `main` only after the user approves this feature.
