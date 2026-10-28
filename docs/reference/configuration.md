# Configuration reference

Every setting a Hedra app reads when you call `new Hedra()`.

A value comes from the environment first. When `HEDRA_ENV_FILE` names a file, that file fills any variable the environment doesn't set. When `HEDRA_ENV_FILE` is unset, or names a file that doesn't exist, Hedra reads `.env` in the working directory if one exists. A blank value counts as unset, and anything still unset takes its default. An invalid value makes `new Hedra()` throw a `ConfigurationError`.

`hedra.config` holds each value as a string under the key in the second column. It also holds `instanceId`, a new UUID for each app.

| Variable | `hedra.config` key | Default | Description |
| --- | --- | --- | --- |
| `HEDRA_DEPLOYMENT_DOMAIN` | `deploymentDomain` | `hedra.local` | The root domain of the deployment. Must be a domain |
| `HEDRA_DEPLOYMENT_API_DOMAIN` | `deploymentApiDomain` | `deployment.hedra.local` | The domain of the deployment API. Must be a domain |
| `HEDRA_DEPLOYMENT_DOCS_DOMAIN` | `deploymentDocsDomain` | `docs.hedra.local` | The domain of the docs. Must be a domain |
| `HEDRA_SERVER_ENV` | `serverEnv` | `dev` | The environment the server runs in: `test`, `dev`, `nonprod` or `prod` |
| `HEDRA_SERVER_SILENT_STARTUP` | `serverSilentStartup` | `false` | `true` hides the settings table at startup |
| `HEDRA_SERVER_LOG_TYPE` | `serverLogType` | `pino` | `pino` writes JSON lines. `pino-pretty` and `dev` write readable lines |
| `HEDRA_SERVER_LOG_LEVEL` | `serverLogLevel` | `info` | The lowest level logged: `trace`, `debug`, `info`, `warn`, `error`, `fatal` or `silent` |
| `HEDRA_SERVER_HTTP_LOGGING` | `serverHttpLogEnabled` | `true` | Enables or disables HTTP request and response logging |
| `HEDRA_SERVER_PORT` | `serverPort` | `3000` | The port the server listens on, an integer from 1 to 65535 |
| `HEDRA_SERVER_REQUEST_TIMEOUT` | `serverRequestTimeout` | `30000` | Milliseconds to wait for a request to complete, an integer from 1 to 300000 |
| `HEDRA_ENV_FILE` | none | unset | A file of `KEY=value` lines to read settings from |

Related: [Models reference](models.md), [Glossary](glossary.md)
