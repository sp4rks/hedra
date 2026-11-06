# Logging

`app.log` uses Hedra's library-independent `Logger` interface. `HEDRA_SERVER_LOG_LIBRARY` selects the implementation; its default and only accepted value is currently `pino`. The default output is JSON to stdout at level `info`. Set `HEDRA_SERVER_LOG_FORMAT=pretty` for readable output, and `HEDRA_SERVER_LOG_LEVEL` for the minimum level. See [configuration](configuration.md#settings) for accepted values.

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

Import the public `Logger` and `LogFields` types from the package entry point. `LogFields` accepts string keys and values of unknown type. Every implementation provides these methods:

```ts
interface Logger {
  trace(message: string, fields?: LogFields): void
  debug(message: string, fields?: LogFields): void
  info(message: string, fields?: LogFields): void
  warn(message: string, fields?: LogFields): void
  error(message: string, fields?: LogFields): void
  fatal(message: string, fields?: LogFields): void
}
```

There is no Pino type in this contract. Logging methods return `void`; implementations determine how records reach their destinations.

## Context and controller access

Hedra creates one logger with its `instanceId` bound during construction. Pass `app.log` to controllers and other application objects to retain that identity.

The [controller example](../examples/03-controller.ts) accepts `Config` and `Logger` in its constructor. It uses `this.config` and `this.log` without depending on Hedra, an HTTP context or process-global services.

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

Pass additional context as the second argument to a logging call. Initial field records are copied during construction; per-call fields override matching initial fields. Avoid overriding `instanceId` when retaining app identity.

Pino uses `level`, `time` and `msg` for record metadata. Supplying these names as structured fields can produce duplicate JSON keys. Use application-specific field names for portable context; the generic `LogFields` interface does not reserve backend-specific names.

## Select the logging library

Hedra creates its logger through `createLogger(config, bindings?)`, which returns the generic `Logger` interface. The factory uses the loaded `config.serverLogLibrary` to select the implementation. Unsupported library values throw a `ConfigurationError` when `Config` loads them. Hedra supplies its instance ID as the initial bindings. Initial and per-call log fields are validated separately by the logging implementation.

Use the same factory to construct a logger independently of Hedra:

```ts
import { Config, createLogger } from '#hedra.ts'

const logger = createLogger(new Config(), { service: 'worker' })

logger.info('Logger configured')
```

`Config()` loads the process environment, environment files and defaults. Library selection is separate from output format: `HEDRA_SERVER_LOG_LIBRARY=pino` works with either `json` or `pretty` output. `pretty` is not a valid library name.

## Standalone destinations

For standalone logging, `PinoLogger` accepts a `Config`, an optional standard writable destination and optional initial fields. For example, this creates a logger that writes to stderr:

```ts
import { Config, PinoLogger } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
const logger = new PinoLogger(config, process.stderr, { service: 'worker' })

logger.info('Worker configured')
```

The logging library, level and format for `app.log` come from Hedra's configuration. The standalone constructor does not reconfigure an existing app logger.

The native Pino object is private. Pino-specific methods such as `bindings()` and its mutable `level` property are not available through `app.log`. Inspect emitted records when testing logging behaviour.

`app.close()` retains its database lifecycle. A caller that supplies a writable stream remains responsible for that stream's lifetime.

## Migrating logging calls

`loadAppLogger(config, destination)` becomes `new PinoLogger(config, destination)`. Existing `app.log.info('message')` calls remain valid. Change object-first calls to message-first calls:

```ts
app.log.error('Database operation failed', { err: error })
```

The example above assumes an `error` from application error handling. See the configuration reference for the log-format environment-variable migration.

`PinoLogger.create(config)` becomes `createLogger(config)`. The factory's optional second argument now contains initial fields rather than a prebuilt logger. The `PinoLogger` constructor retains its writable-destination argument and accepts initial fields as a third argument.

Remove the `logger` option from `new Hedra({ logger })` and use `app.log`. Logger injection and `child()` have been removed. Replace `logger.child(fields).info(message)` with `logger.info(message, fields)` when adding context to a message.
