# Configuration

`Config` loads and validates a snapshot of Hedra's settings. Its properties are directly accessible and read-only in TypeScript. Ports and timeouts are numbers; flags are booleans.

For persisted tenant definitions, see the separate [configuration store](config-store.md).

```ts
import { Hedra } from '#hedra.ts'

const app = new Hedra()

app.config.serverListenPort // A number, loaded from the environment or the default.
app.config.serverSilentStartup // A boolean.
app.instanceId // A unique identifier for this app.
```

The imports above use this repository's package entry alias. Run examples from the repository root with Bun and the installed dependencies.

## Construct an application

`new Hedra()` creates a `Config` from the environment Bun has already loaded and the built-in defaults, then creates a default logger. Configure the process environment before constructing the app; no environment argument is needed.

The options are `config`, `logger`, `configDatastore` and `backend`. To share a configuration instance, pass `new Hedra({ config })`; the app retains that instance. For isolated tests or an explicit environment snapshot, construct the dependency with `new Config(environment)` and pass it as `config`.

Supply `logger` to use any implementation of `LoggerInterface`; Hedra retains the supplied instance and the implementation controls its own context and output. Otherwise Hedra creates `new Logger(config, undefined, { instanceId })`. See [supplying a logger](logging.md#supply-a-logger).

Supply `configDatastore` to borrow any implementation of `ConfigDatastore`; Hedra exposes that same instance through `app.configDatastore`. Otherwise, the first access or accepted built-in tenant operation constructs a default `ConfigStore` using `app.config`. Backend setup belongs to that store. Hedra closes its default store on app closure and leaves supplied stores open. See the [configuration datastore](config-store.md).

Supply `backend` to borrow the storage backend for application collections and associations; otherwise Hedra lazily creates and owns their default SQLite backend on registration. This option does not configure `app.configDatastore`. See [backend ownership](backends.md#connection-ownership).

`HedraOptions` is a plain TypeScript type for these options and their dependencies. Unknown option properties are ignored at runtime. The constructor relies on callers to supply implementations of `ConfigDatastore`, `Backend` and `LoggerInterface`; it does not check their methods at runtime.

Invalid configuration throws before server startup. Embedded applications can catch construction errors; an uncaught error during Bun startup exits with a nonzero status. Library construction does not terminate the host process itself.

`Config` validates environment input and resolved settings during construction, before reporting success. Hedra and its default logger consume the loaded instance directly. Invalid settings fail configuration loading before default logger creation or database access, even when a custom logger is supplied. Each default app logger has its `instanceId` bound during construction. See [logging](logging.md) for the generic interface and app context.

`Config` and `Logger` can also be used independently of Hedra. Supply them to controllers through their constructors, as in the [controller example](../examples/03-controller.ts). A controller can then use `this.config` and `this.log` without importing the HTTP app.

## Settings

Environment values are strings. Hedra trims them, applies defaults for unset or blank values and validates the resulting native values. Boolean variables accept exactly `true` or `false` after trimming. Invalid values throw a `ConfigurationError` identifying the variable. See [error constructors](errors.md) for fixed statuses and custom title/detail arguments.

| Environment variable | Config property | Type and accepted values | Default |
| --- | --- | --- | --- |
| `HEDRA_DEPLOYMENT_DOMAIN` | `deploymentDomain` | Valid domain string | `hedra.local` |
| `HEDRA_DEPLOYMENT_API_DOMAIN` | `deploymentApiDomain` | Valid domain string | `deployment.hedra.local` |
| `HEDRA_DEPLOYMENT_DOCS_DOMAIN` | `deploymentDocsDomain` | Valid domain string | `docs.hedra.local` |
| `HEDRA_SQLITE_PATH` | `sqlitePath` | Nonempty path string, or `:memory:` | `.runtime/hedra.sqlite` |
| `HEDRA_SERVER_ENV` | `serverEnv` | `test`, `dev`, `nonprod`, `prod` | `dev` |
| `HEDRA_SERVER_SILENT_STARTUP` | `serverSilentStartup` | Boolean | `false` |
| `HEDRA_SERVER_LOG_LIBRARY` | `serverLogLibrary` | `pino` | `pino` |
| `HEDRA_SERVER_LOG_FORMAT` | `serverLogFormat` | `json`, `pretty` | `json` |
| `HEDRA_SERVER_LOG_LEVEL` | `serverLogLevel` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info` |
| `HEDRA_SERVER_HTTP_LOGGING` | `serverHttpLogEnabled` | Boolean | `true` |
| `HEDRA_SERVER_PRINT_ROUTES` | `serverPrintRoutes` | Boolean | `false` |
| `HEDRA_SERVER_LISTEN_IP` | `serverListenIp` | IPv4 or IPv6 string | `0.0.0.0` |
| `HEDRA_SERVER_LISTEN_PORT` | `serverListenPort` | Integer from 1 through 65535 | `3000` |
| `HEDRA_SERVER_REQUEST_TIMEOUT` | `serverRequestTimeout` | Integer from 1 through 300000, in milliseconds | `30000` |

`serverHttpLogEnabled` retains its configuration meaning; this change does not add HTTP logging middleware. Connection ownership and persistent-volume requirements are described in [storage backends](backends.md).

`HEDRA_SQLITE_PATH` selects the default path for both configuration storage and application collections. They open independent connections; using `:memory:` gives each independent storage. To share a connection explicitly, supply both dependencies as described under [sharing a backend](config-store.md#share-a-backend-with-application-resources).

Set `serverPrintRoutes` through `HEDRA_SERVER_PRINT_ROUTES=true` to log collection registration messages at level `info`. These messages follow the logger's configured filtering; `silent` suppresses them.

`HEDRA_SERVER_LOG_LIBRARY` configures the default logging implementation; `pino` is currently the only accepted value. Unsupported values prevent startup. Output format and minimum level remain separate settings. Supply a custom logger through the `logger` option to use another implementation. See [logging](logging.md#select-the-logging-library) for the default class and generic interface.

## Environment files and reporting

Bun loads environment files before application code runs. Hedra reads the resulting `process.env`; it does not open or parse environment files. Bun controls file selection, precedence and file errors. See [Bun's environment documentation](https://bun.com/docs/runtime/environment-variables).

To select a custom file when running the hello-world example, run this from the repository root with your environment file at `./app.env`:

```sh
bun --env-file=./app.env examples/01-helloworld.ts
```

Use Bun's `--no-env-file` flag to disable automatic file loading. `HEDRA_ENV_FILE` no longer selects a file; replace it with Bun's `--env-file` flag.

An explicit `new Config(environment)` uses only that snapshot, without loading files or merging ambient variables. Supplied environment objects are copied rather than modified. Unset or blank setting values use their built-in defaults.

After successful validation, startup prints the settings, their values and whether each came from the environment or a default. File-provided values count as environment values in this report. Set `HEDRA_SERVER_SILENT_STARTUP=true` to suppress the report. Invalid settings prevent a success report.

## Configuration types

The category definitions in `src/server/configs/deployment.ts` and `src/server/configs/server.ts` provide each setting's environment-variable name, property name, default, metadata and Zod schema. Hedra derives the complete validation schema and the read-only `Config` property types from those entries. Adding a built-in setting requires its category entry, without a separate values-schema entry or class property declaration.

`Config` is a concrete loader that stores validated properties directly; there is no public `values` object. The class is not generic, and its validation and reporting helpers are private static methods.

Read-only properties are a TypeScript guarantee; the object is not frozen at runtime. Runtime mutation and live configuration reload are not supported configuration APIs. Consumers trust the loaded instance and do not revalidate it.

## Migrating existing callers

| Previous usage | Current usage |
| --- | --- |
| `new Hedra(env)` or `new Hedra({ env })` | `new Hedra()` to load the process environment |
| `loadServerConfig(env)` | `new Config(env)` |
| `config.serverListenPort === '3000'` | `config.serverListenPort === 3000` |
| `config.serverSilentStartup === 'false'` | `config.serverSilentStartup === false` |
| `config.instanceId` | `app.instanceId` |
| `HEDRA_SERVER_LOG_TYPE=pino` | `HEDRA_SERVER_LOG_FORMAT=json` |
| `HEDRA_SERVER_LOG_TYPE=pino-pretty` or `dev` | `HEDRA_SERVER_LOG_FORMAT=pretty` |

If a caller previously supplied an explicit environment snapshot, preserve it with `new Hedra({ config: new Config(env) })`. Hedra no longer reads an `env` option; like other unknown properties, it is ignored at runtime.

Hedra accepts a `logger` option implementing `LoggerInterface`. To configure the default logger, use the environment or supplied `Config`. Pass `app.log` to code that needs logging; custom implementations retain their own context and output settings.

The old log-type setting and values are no longer supported. Remove old names when migrating. Select the library with `HEDRA_SERVER_LOG_LIBRARY` and the output format with `HEDRA_SERVER_LOG_FORMAT`; the old `HEDRA_SERVER_LOG_TYPE` variable is ignored.
