# Logging

`Logger` is Hedra's default Pino implementation of the library-independent `LoggerInterface`. Hedra constructs it when no logger is supplied. The default output is JSON to stdout at level `info`. Set `HEDRA_SERVER_LOG_FORMAT=pretty` for readable output, and `HEDRA_SERVER_LOG_LEVEL` for the minimum level. See [configuration](configuration.md#settings) for accepted values.

Messages come first, followed by optional structured fields:

```ts
import { Hedra } from '#hedra.ts'

const app = new Hedra()

app.log.info('Server configured', { port: app.port })
app.log.warn('Upstream response was slow', { elapsedMs: 1500 })
app.log.error('Upstream request failed', { err: new Error('Connection refused') })
```

The default adapter serializes errors under `err`, retaining useful details including the message and stack. Choose fields deliberately; never log secrets or tenant data.

## Logger interface

Import the public `LoggerInterface` and `LogFields` types from the package entry point. Use `LoggerInterface` for dependencies that can accept any implementation. `LogFields` accepts string keys and values of unknown type. Every implementation provides these methods:

```ts
interface LoggerInterface {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
}
```

There is no Pino type in this contract. Logging methods return `void`; implementations determine how records reach their destinations. A replacement class implements `LoggerInterface` without extending `Logger`.

## Context and controller access

Hedra's default logger has its `instanceId` bound during construction. Pass `app.log` to controllers and other application objects to retain that identity. A supplied logger controls its own context; Hedra does not add an instance ID to it.

The [controller example](../examples/03-controller.ts) accepts `Config` and `LoggerInterface` in its constructor. It uses `this.config` and `this.log` without depending on Hedra, an HTTP context or process-global services.

From the repository root, exercise that example without opening a network listener:

```sh
HEDRA_SERVER_ENV=test HEDRA_SERVER_SILENT_STARTUP=true HEDRA_SERVER_LOG_LEVEL=silent bun run - <<'TS'
import assert from 'node:assert/strict'

import app from './examples/03-controller.ts'

try {
  const response = await app.request('/')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { environment: 'test' })
} finally {
  app.close()
}
TS
```

The command exits with status `0` and no output. Assertion failures or configuration errors exit with an error.

Pass additional context as the second argument to a logging call. `Logger` validates and copies initial field records during construction; per-call fields are also validated and override matching initial fields. Avoid overriding `instanceId` when retaining app identity.

The default `Logger` reports validation and synchronous logging failures through the [Hedra error hierarchy](errors.md#wrapped-failures). A supplied logger keeps its own error contract when called directly.

Pino uses `level`, `time` and `msg` for record metadata. Supplying these names as structured fields can produce duplicate JSON keys. Use application-specific field names for portable context; the generic `LogFields` interface does not reserve backend-specific names.

## Select the logging library

Hedra creates its default logger with `new Logger(config, undefined, { instanceId })`. `HEDRA_SERVER_LOG_LIBRARY` defaults to and accepts only `pino`; unsupported values throw a `ConfigurationError` when `Config` loads them. To use another implementation, supply a logger through the `logger` option described below.

Construct a logger independently of Hedra:

```ts
import { Logger } from '#hedra.ts'

const logger = new Logger()

logger.info('Logger configured')
```

With no configuration argument, `Logger` constructs a `Config` that loads the process environment, environment files and defaults, including the startup report unless suppressed. Supply an existing `Config` to reuse its loaded settings. Library selection is separate from output format: `HEDRA_SERVER_LOG_LIBRARY=pino` works with either `json` or `pretty` output. `pretty` is not a valid library name.

## Standalone destinations

`Logger` accepts an optional `Config`, an optional standard writable destination and optional initial fields, in that order. For example, this creates a logger that writes to stderr:

```ts
import { Config, Logger } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
const logger = new Logger(config, process.stderr, { service: 'worker' })

logger.info('Worker configured')
```

The level and format of a default app logger come from Hedra's configuration. Constructing another logger does not reconfigure an existing app logger.

The native Pino object is private. Pino-specific methods such as `bindings()` and its mutable `level` property are not available through `app.log`. Inspect emitted records when testing logging behaviour.

`app.close()` retains its database lifecycle. A caller that supplies a writable stream remains responsible for that stream's lifetime.

## Supply a logger

Pass an instance of any class implementing `LoggerInterface` as `new Hedra({ logger })`. Hedra retains that exact instance. It does not wrap, mutate or close a supplied logger, and it does not apply its logging settings to it. The implementation owns field validation, context, filtering, output and cleanup.

For example, this supplies a configured default implementation through the same interface a replacement class uses:

```ts
import type { LoggerInterface } from '#hedra.ts'
import { Config, Hedra, Logger } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
const logger: LoggerInterface = new Logger(config, process.stderr, { service: 'api' })
const app = new Hedra({ config, logger })

app.log.info('Application configured')
app.close()
```

This logger binds `service` and has no app instance ID. Keep a reference to a replacement class instance when you need methods beyond `LoggerInterface`; `app.log` exposes only the six logging methods. Hedra still loads and validates its own configuration when using a supplied logger.

## Migrating logging calls

`loadAppLogger(config, destination)` becomes `new Logger(config, destination)`. Existing `app.log.info('message')` calls remain valid. Change object-first calls to message-first calls:

```ts
app.log.error('Database operation failed', { err: error })
```

The example above assumes an `error` from application error handling. See the configuration reference for the log-format environment-variable migration.

| Previous usage | Current usage |
| --- | --- |
| `createLogger(config)` or `PinoLogger.create(config)` | `new Logger(config)` |
| `createLogger(config, bindings)` | `new Logger(config, undefined, bindings)` |
| `new PinoLogger(config, destination, bindings)` | `new Logger(config, destination, bindings)` |
| `import type { Logger }` for a replaceable dependency | `import type { LoggerInterface }` |

`createLogger` and `PinoLogger` are no longer exported. Logger injection is available through `new Hedra({ logger })`. `child()` remains removed; use `logger.info(message, fields)` for message-specific context, or the constructor's third argument for initial fields.
