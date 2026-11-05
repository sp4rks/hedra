# Logging

`app.log` uses Hedra's `Logger` interface. The default implementation is `PinoLogger`, which writes JSON to stdout at level `info`. Set `HEDRA_SERVER_LOG_FORMAT=pretty` for readable output, and `HEDRA_SERVER_LOG_LEVEL` for the minimum level. See [configuration](configuration.md#settings) for accepted values.

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
  child(fields: LogFields): Logger
}
```

There is no Pino type in this contract. Logging methods return `void`; implementations determine how records reach their destinations.

## Context and controller access

Hedra creates a child logger bound to its `instanceId`, keeping the supplied parent logger unchanged. Pass `app.log` to controllers and other application objects to retain that identity. The parent logger supplied to Hedra does not acquire the app's bindings.

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

Use `child(fields)` for additional context. A child inherits its parent's fields without mutating the parent or its siblings. New child fields override matching inherited fields; fields on an individual logging call override matching bindings. Avoid overriding `instanceId` when retaining app identity.

Children retain the implementation's output behaviour. If an application subclasses an adapter and overrides its logging behaviour, its `child` implementation must preserve that behaviour too.

## Destinations and other backends

`PinoLogger` accepts a `Config` and an optional standard writable destination. For example, this sends application logs to stderr:

```ts
import { Config, Hedra, PinoLogger } from '#hedra.ts'

const config = new Config({ HEDRA_SERVER_SILENT_STARTUP: 'true' })
const logger = new PinoLogger(config, process.stderr)
const app = new Hedra({ config, logger })

app.log.info('Application configured')
```

To use another backend, implement `Logger` and supply its instance through the `logger` option. Hedra uses that interface and adds app context through `child`; it does not inspect a native backend object or reconfigure a shared logger globally.

Configuration level and format settings configure the default Pino adapter. A supplied implementation owns its output policy and can consume `Config` when constructed. Its `child` method must provide independent bindings and retain that policy.

The native Pino object is private. Pino-specific methods such as `bindings()` and its mutable `level` property are not available through `app.log`. Inspect emitted records when testing logging behaviour.

`app.close()` retains its database lifecycle. A caller that supplies a writable stream remains responsible for that stream's lifetime.

## Migrating logging calls

`loadAppLogger(config, destination)` becomes `new PinoLogger(config, destination)`. Existing `app.log.info('message')` calls remain valid. Change object-first calls to message-first calls:

```ts
app.log.error('Database operation failed', { err: error })
```

The example above assumes an `error` from application error handling. See the configuration reference for the log-format environment-variable migration.
