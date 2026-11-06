# Configuration

`Config` loads and validates a snapshot of Hedra's settings. Its properties are directly accessible and read-only in TypeScript. Ports and timeouts are numbers; flags are booleans.

For persisted tenant definitions, see the separate [configuration store](config-store.md).

```ts
import { Config, Hedra } from '#hedra.ts'

const config = new Config({
  HEDRA_SERVER_LISTEN_PORT: '8080',
  HEDRA_SERVER_SILENT_STARTUP: 'true',
})
const app = new Hedra({ config })

config.serverListenPort // 8080
config.serverSilentStartup // true
app.instanceId // A unique identifier for this app.
```

The imports above use this repository's package entry alias. Run examples from the repository root with Bun and the installed dependencies.

## Construct an application

`new Hedra()` creates configuration from `process.env` and a default logger. To supply an environment snapshot, use `new Hedra({ env: environment })`. To share a configuration instance or use a subclass, pass `new Hedra({ config })`; the app retains that instance.

The options are `env`, `config`, `logger` and `backend`. Supply `backend` to borrow an existing storage backend shared with other apps or configuration stores; otherwise Hedra lazily creates and owns its default SQLite backend. See [backend ownership](backends.md#connection-ownership).

Supplying both `env` and `config`, an unknown option, an invalid configuration, an invalid logger or a malformed backend throws. Configuration errors prevent server startup. Embedded applications can catch construction errors; an uncaught error during Bun startup exits with a nonzero status. Library construction does not terminate the host process itself.

Configuration is fully validated before Hedra creates its default logger or opens a database. Supplied configuration is checked again, including values overridden by subclasses. Each app has its own `instanceId`, even when configuration or a parent logger is shared. See [logging](logging.md) for custom backends and app-bound context.

`Config` and `Logger` can also be used independently of Hedra. Supply them to controllers through their constructors, as in the [controller example](../examples/03-controller.ts). A controller can then use `this.config` and `this.log` without importing the HTTP app.

## Settings

Environment values are strings. Hedra trims them, applies defaults for unset or blank values and validates the resulting native values. Boolean variables accept exactly `true` or `false` after trimming. Invalid values throw a `ConfigurationError` identifying the variable; file-access failures also propagate. See [error constructors](errors.md) for fixed statuses and custom title/detail arguments.

| Environment variable | Config property | Type and accepted values | Default |
| --- | --- | --- | --- |
| `HEDRA_DEPLOYMENT_DOMAIN` | `deploymentDomain` | Valid domain string | `hedra.local` |
| `HEDRA_DEPLOYMENT_API_DOMAIN` | `deploymentApiDomain` | Valid domain string | `deployment.hedra.local` |
| `HEDRA_DEPLOYMENT_DOCS_DOMAIN` | `deploymentDocsDomain` | Valid domain string | `docs.hedra.local` |
| `HEDRA_SQLITE_PATH` | `sqlitePath` | Nonempty path string, or `:memory:` | `.runtime/hedra.sqlite` |
| `HEDRA_SERVER_ENV` | `serverEnv` | `test`, `dev`, `nonprod`, `prod` | `dev` |
| `HEDRA_SERVER_SILENT_STARTUP` | `serverSilentStartup` | Boolean | `false` |
| `HEDRA_SERVER_LOG_FORMAT` | `serverLogFormat` | `json`, `pretty` | `json` |
| `HEDRA_SERVER_LOG_LEVEL` | `serverLogLevel` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` | `info` |
| `HEDRA_SERVER_HTTP_LOGGING` | `serverHttpLogEnabled` | Boolean | `true` |
| `HEDRA_SERVER_PRINT_ROUTES` | `serverPrintRoutes` | Boolean | `false` |
| `HEDRA_SERVER_LISTEN_IP` | `serverListenIp` | IPv4 or IPv6 string | `0.0.0.0` |
| `HEDRA_SERVER_LISTEN_PORT` | `serverListenPort` | Integer from 1 through 65535 | `3000` |
| `HEDRA_SERVER_REQUEST_TIMEOUT` | `serverRequestTimeout` | Integer from 1 through 300000, in milliseconds | `30000` |

`serverHttpLogEnabled` retains its configuration meaning; this change does not add HTTP logging middleware. Connection ownership and persistent-volume requirements are described in [storage backends](backends.md).

Set `serverPrintRoutes` through `HEDRA_SERVER_PRINT_ROUTES=true` to log collection registration messages at level `info`. These messages follow the logger's configured filtering; `silent` suppresses them.

## Environment files and reporting

Set `HEDRA_ENV_FILE` to select an environment file. It controls loading and is not a resolved configuration property. Explicit environment values win over file values, which win over built-in defaults.

A file fills only variables whose value is `undefined`. An explicitly blank variable subsequently uses the built-in default, even when the file contains a value for that variable. Supplied environment objects are copied rather than modified.

When using the ambient `process.env`, Hedra falls back to `.env` if no file is selected or the selected file is missing. A supplied custom environment reads its selected file, but does not implicitly read the ambient `.env`. Missing files retain the applicable fallback; other file-read failures throw.

After successful validation, startup prints the settings, their values and whether each came from the environment or a default. File-provided values count as environment values in this report. Set `HEDRA_SERVER_SILENT_STARTUP=true` to suppress the report. Invalid settings prevent a success report.

## Types and subclasses

Zod schemas provide the property types and validation. `Config` stores validated properties directly; there is no public `values` object. The class is not generic.

Read-only properties are a TypeScript guarantee. The object is not frozen at runtime, allowing subclasses to initialize additional fields. Runtime mutation and live configuration reload are not supported configuration APIs.

`app.config` exposes the built-in `Config` properties. If a subclass adds application-specific fields, keep a reference to that subclass instance to access them with their concrete types. Custom fields need their own application validation.

## Migrating existing callers

| Previous usage | Current usage |
| --- | --- |
| `new Hedra(env)` | `new Hedra({ env })` |
| `loadServerConfig(env)` | `new Config(env)` |
| `config.serverListenPort === '3000'` | `config.serverListenPort === 3000` |
| `config.serverSilentStartup === 'false'` | `config.serverSilentStartup === false` |
| `config.instanceId` | `app.instanceId` |
| `HEDRA_SERVER_LOG_TYPE=pino` | `HEDRA_SERVER_LOG_FORMAT=json` |
| `HEDRA_SERVER_LOG_TYPE=pino-pretty` or `dev` | `HEDRA_SERVER_LOG_FORMAT=pretty` |

The old log-type setting and values are no longer supported. Remove old names when migrating; unknown environment variables do not select a backend or output format.
