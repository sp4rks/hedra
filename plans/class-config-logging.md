# Class-based configuration and backend-independent logging

Status: implemented and independently reviewed; awaiting approval to merge into `main`. The final design includes constructor injection for controllers.

## Purpose

Give Hedra a consistent class-based structure with direct, typed configuration access and a logging interface independent of Pino. Normal setup remains `new Hedra()`. Applications can supply configuration subclasses or another logging implementation without needing an extension framework.

Keep the existing Bun container runtime, sensible defaults, environment-file behaviour and database lifecycle. Add no dependencies.

## Public interface

```ts
const app = new Hedra()

app.config.serverListenPort // number
app.config.serverSilentStartup // boolean
app.instanceId // string, unique to this app
app.log.info('Server started', { port: app.port })

const config = new Config(environment)
const custom = new Hedra({ config, logger: customLogger })
const overridden = new Hedra({ env: environment })
```

The package entry point exports the values `Config`, `Hedra`, `Collection` and `PinoLogger`, and the types `Logger`, `LogFields` and `HedraOptions`. The configuration and options schemas remain internal, with their types inferred from Zod.

`HedraOptions` allows optional `env`, `config` and `logger` properties. `env` is a string/undefined environment map; `config` is a `Config` instance, including subclasses; `logger` satisfies the Hedra logging interface. Reject unknown option keys and the simultaneous presence of `env` and `config`. A supplied logger may accompany either configuration source.

With neither configuration option, construct `Config` from `process.env`. Validate the built-in values of a supplied configuration instance before using it, preserving its identity and additional subclass properties. This catches invalid field overrides performed after a subclass calls `super`. `Hedra.config` is typed as `Config`; applications retain their concrete subclass reference when using additional subclass-specific properties.

`Config` and `Logger` remain independently constructible dependencies. Controllers accept the objects they need in their constructors and use `this.config` / `this.log`; they do not import Hedra or use a process-global service registry. Wiring a controller with `app.config` and `app.log` gives it the same validated configuration and app-bound logging context. Demonstrate this in a standalone example, without introducing a controller base class or registration API.

## Configuration

`Config` loads the environment, resolves the existing env-file precedence, validates the complete result and stores the parsed values directly on itself. It exposes one schema-derived declaration per setting and assigns the parsed record once:

```ts
declare readonly serverListenPort: ConfigValues['serverListenPort']
declare readonly serverSilentStartup: ConfigValues['serverSilentStartup']

// After resolving names, applying defaults and decoding environment strings:
Object.assign(this, ConfigValues.parse(input))
```

`ConfigValues` names the composed Zod schema and its inferred output type. These are declarations inside the class, not additional stored state. There are no public getters or `values` object. `readonly` is enforced by TypeScript; the base constructor does not freeze the instance, allowing subclasses to initialize their own fields.

The old `Config` definition-map name becomes `ConfigDefinitions` wherever a dictionary is still needed. Definition dictionaries remain plain data; the runtime class does not extend `Record` or use a broad index signature. Keep field schemas, defaults and environment-name/description metadata together in the existing category modules, composed into `ConfigValues`. Retain parsed outputs instead of discarding them through void-returning validators. Avoid parallel manually written value types or another list of validation rules.

`ConfigValues` validates required native values without coercion, fallback defaults or normalization. Resolve defaults, trim raw strings and decode environment representations before that final parse. The same schema can then validate an injected instance without silently accepting missing properties or changing the values of the supplied object.

| Property | Output type | Default |
| --- | --- | --- |
| `deploymentDomain` | string, valid domain | `hedra.local` |
| `deploymentApiDomain` | string, valid domain | `deployment.hedra.local` |
| `deploymentDocsDomain` | string, valid domain | `docs.hedra.local` |
| `sqlitePath` | nonempty string | `.runtime/hedra.sqlite` |
| `serverEnv` | `test`, `dev`, `nonprod` or `prod` | `dev` |
| `serverSilentStartup` | boolean | `false` |
| `serverLogFormat` | `json` or `pretty` | `json` |
| `serverLogLevel` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent` | `info` |
| `serverHttpLogEnabled` | boolean | `true` |
| `serverListenIp` | string, valid IPv4 or IPv6 address | `0.0.0.0` |
| `serverListenPort` | integer, 1 through 65535 | `3000` |
| `serverRequestTimeout` | integer, 1 through 300000 | `30000` |

Use `HEDRA_SERVER_LOG_FORMAT` for `serverLogFormat`; other settings retain their current environment names. Trim input strings. Boolean environment values accept only `true` or `false` after trimming, and produce actual booleans. In particular, `false` must never become truthy through generic boolean coercion.

Preserve environment resolution:

- Copy the supplied environment without mutating it.
- An env file fills only keys whose value is `undefined`. A blank explicit value subsequently falls back to the built-in default, rather than taking a file value.
- Read `HEDRA_ENV_FILE` when supplied. For the ambient `process.env`, preserve fallback to `.env` when the selected file is missing or no file was selected. A custom environment does not implicitly read the ambient `.env`.
- A missing file retains the existing fallback behaviour. File-read or parse failures propagate and prevent construction.
- Keep the human-facing startup report and source labels, controlled by the validated `serverSilentStartup` boolean. Print it to stdout only after the complete configuration passes validation; this report is independent of the application logging backend.

Subclasses can prepare their environment before calling `super` and initialize additional state afterward. Base construction does not call overridable hooks that depend on subclass initialization. Arbitrary subclass-schema inference, live configuration changes and configuration-provider hierarchies are outside this change.

## Logging

The public contract uses no Pino types:

```ts
interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
  child(fields: LogFields): Logger
}
```

`LogFields` is inferred from a Zod record schema accepting string keys and unknown values. Fields supply structured context, including `Error` instances under `err`. The default adapter preserves useful error information, including the message and stack.

`child` returns a logger with additional bindings without mutating its parent or siblings. Children inherit parent bindings; newer child bindings override matching parent keys, and explicit per-call fields override matching bindings. Implementations preserve their logging behaviour in children. An application subclass that changes adapter behaviour is responsible for ensuring its `child` implementation retains that behaviour.

`PinoLogger` implements this interface. Its constructor accepts `Config` and an optional standard writable destination; omitted destinations use stdout. Keep the native Pino instance private. Retain level filtering, JSON output and the existing readable pretty output, translating message-first calls into Pino's calling convention.

The configured level and format control the default adapter. An injected logger owns its own output policy and can use the supplied application's configuration when constructed. Hedra always binds app identity through `child`; it does not alter an injected backend's global configuration. There is no backend registry or dynamic library loading.

## Construction, identity and startup failures

1. Validate the options and obtain a fully validated `Config`.
2. Generate a new app-owned `instanceId`.
3. Use the supplied logger or create `PinoLogger` from the configuration, then obtain a child bound to this `instanceId`.
4. Set `port` and `hostname` directly from their typed configuration properties. Preserve existing routing and lazy database ownership.

**Any configuration failure prevents startup.** `Config` throws `ConfigurationError` for invalid setting values, retaining the environment-variable name and useful existing field-specific error details. File-access failures also throw. `Hedra` does not return a usable app, initialize its default logger, open SQLite or begin listening after a failure. Supplied configuration and logger construction performed by the caller is outside Hedra's control.

Remove the global Pino logger from the configuration module. Configuration errors propagate to the caller. During normal Bun startup, an uncaught error prevents the default-exported app from becoming available and exits the process with a nonzero status. Embedded callers can catch the exception; library construction does not call `process.exit` or change the process exit code.

Each app keeps a distinct ID even when a configuration or parent logger is shared. Identity appears on emitted application logs; Pino's `bindings()` is not part of the public contract. Preserve the existing `close()` and lazy SQLite lifecycle; this feature adds no logger-destination ownership or asynchronous shutdown protocol.

## Files and migrations

| Location | Responsibility |
| --- | --- |
| `src/server/config/config.ts` | `Config`, composed configuration schema/type, resolution and reporting |
| `src/server/config/categories/deployment.ts` | Deployment field schemas and metadata |
| `src/server/config/categories/server.ts` | Server field schemas and metadata |
| `src/server/logging/logging.ts` | Logging interface, field schema/type and default adapter |
| `src/server/server.ts` | Options validation, construction order and app-owned identity |
| `src/hedra.ts` | Deliberate public exports |
| Existing config, logging, Hedra and startup suites | Behaviour verification after test-design approval |
| `docs/` and tracked examples | Usage and migration documentation during the documentation stage |

Migrate all affected tracked callers:

- `new Hedra(env)` becomes `new Hedra({ env })`; `new Hedra()` remains valid.
- `loadServerConfig(env)` becomes `new Config(env)`.
- `loadAppLogger(config, destination)` becomes `new PinoLogger(config, destination)`.
- Numeric and boolean settings become native values; remove downstream conversions and string comparisons.
- `config.instanceId` becomes `app.instanceId`.
- `HEDRA_SERVER_LOG_TYPE` / `serverLogType` become `HEDRA_SERVER_LOG_FORMAT` / `serverLogFormat`. Replace `pino` with `json`, and `pino-pretty` or `dev` with `pretty`; provide no compatibility aliases.
- Pino object-first logging calls become message-first calls. Consumers inspect emitted records instead of Pino-specific properties or methods on `app.log`.

Preserve collection interfaces, routes, persistence and separately owned working-tree changes. Existing collection generics remain unchanged. The paused global house-rule change is outside this feature.

## Verification

Use test-first development at the existing public seams. Implement one failing behaviour and its smallest passing change at a time. These checks belong to the requested implementation; no private-method tests or new dependencies are needed.

| Public seam | Named behaviour and failure-path checks | Scope |
| --- | --- | --- |
| `new Config(env)` | `Config exposes every default as a direct native property`; `Config preserves false boolean values`; `Config trims overrides and falls back for blanks`; `Config leaves the supplied environment unchanged` | Covers direct initialization and native output; does not test private representation. |
| `new Config(env)` | `Config rejects invalid domains, environment, format, level, booleans, IPs, ports and timeouts with the offending variable name` | Reuse existing cases and add the changed boolean/format contracts. |
| `new Config(env)` and stdout | `Config reports validated values and their sources`; `Config suppresses its report when silent`; `Config prints no success report for invalid settings` | Tests the public startup report, not console helper calls. |
| `new Config(env)` with temporary files | `Config preserves explicit/file/default precedence`; `Config treats an explicit blank as a default rather than a file value`; `Config preserves missing-file and ambient .env fallback`; `Config propagates file-read failures` | Real isolated files; do not change process-wide environment concurrently. |
| `PinoLogger` into a writable destination | `PinoLogger emits structured message-first records`; `PinoLogger supports every log level and filters below the threshold`; `PinoLogger is silent at silent level`; `PinoLogger emits pretty output`; `PinoLogger preserves error messages and stacks` | Observe output; no native Pino inspection. |
| `Logger.child` and emitted records | `Logger children inherit and override bindings`; `Logger children leave parents and siblings unchanged`; `Per-call fields override bindings` | Exercise the concrete default adapter and the public interface. |
| `new Hedra(options)` | `Hedra keeps supplied configuration identity`; `Hedra rejects competing configuration sources, unknown options and malformed loggers`; `Hedra rejects invalid or incomplete Config subclass values before using its logger` | Covers supplied dependencies as a startup boundary. |
| `new Hedra(options)` and emitted records | `Hedra assigns distinct instance IDs when dependencies are shared`; `Hedra binds each app's identity without mutating its parent logger`; `Hedra accepts a non-Pino Logger implementation` | Tests isolation and backend substitution without Pino-only methods. |
| Existing Hono and collection interfaces | `Hedra retains configured listen values and user routes`; `Hedra provides no built-in health route`; preserve the existing collection lifecycle and persistence tests | Main intentionally removed the health route before implementation; do not restore it. |
| Bun child process | `The process entrypoint serves the example route at its configured address`; `Invalid configuration exits nonzero before listening or opening SQLite` | Update stale health-route expectations to the existing `/` example. Bound subprocess lifetimes and clean up ports/files. |
| Controller example and public exports | `A controller uses Config and Logger without depending on Hedra`; imported public types preserve numeric, boolean and read-only property contracts | No controller framework is introduced. |

`bun run check` supplies the complete type, format, import, lint and runtime-test gate. Independently exercise the tracked examples after documentation is merged. An independent reviewer checks the fixed implementation range and the newcomer experience in the docs.

## Acceptance and integration

The design must support default startup, injected configuration and loggers, direct precisely typed configuration properties, isolated app identity and fatal startup validation. It must preserve configuration-source precedence and the established database lifecycle.

Implementation follows test-first development in the feature worktree, with documentation in its separate worktree. Run `bun run check`, obtain an independent read-only review and obtain user approval before merging to `main`.

The project references a `user-docs` skill that is not installed in the shared, project, backup or plugin skill locations. Use the available house documentation standards and docs-style guidance, and include a newcomer pass in the independent review. This substitutes the unavailable documentation procedure without changing the requested feature.

Decision records: [schema-derived configuration](../docs/adr/0004-schema-derived-config-class.md) and [backend-independent logging](../docs/adr/0005-backend-independent-logging.md).

## Verification results

- `bun run check` passed TypeScript, Biome and 110 tests with 338 assertions on implementation commit `bacc025`, including the merged documentation example. The subprocess/loopback checks ran outside the filesystem sandbox.
- The exact runnable commands in `docs/collections.md` and `docs/logging.md` passed on the final implementation. They exercised model CRUD with in-memory SQLite and the controller example through `app.request`.
- Independent review of `81e32b2..2614355`, including the newcomer documentation pass, returned no actionable findings. A focused re-review of the final env-file fix, `2614355..bacc025`, also returned no actionable findings.
- The env-file permission regression failed before the fix and passed afterward. Only `ENOENT` permits fallback; inaccessible files propagate their I/O error. The real permission test executed on non-root Linux and deliberately skips root and Windows.
- Source type regressions cover native number/boolean properties and read-only declarations. Documented limits remain compiler-enforced read-only fields and native Pino metadata-name collisions.
