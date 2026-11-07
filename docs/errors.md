# Errors

Errors raised by Hedra operations are `HedraError` instances or subclasses. This includes validation, file access, SQLite and callback failures that pass through Hedra operations. Each error class sets its HTTP status internally. Constructors accept a title and optional detail; callers do not pass a status.

## Constructor arguments

`HedraError` accepts `(title: string, detail?: string | object)`. Every other class accepts `(title?: string, detail?: string | object)` and uses its existing default title when omitted or passed as `undefined`.

The title is also the standard `Error.message`. The instance's `name` is its class name, and `detail` preserves the supplied string or object. All errors extend `HedraError` and the standard `Error`; database errors also extend `DatastoreError`.

| Class | Status | Default title |
| --- | --- | --- |
| `HedraError` | 500 | Required argument |
| `ConfigurationError` | 500 | `configuration error` |
| `InputValidationError` | 422 | `input validation error` |
| `OutputValidationError` | 500 | `output validation error` |
| `PreconditionFailedError` | 412 | `precondition failed` |
| `BadRequestError` | 400 | `bad request` |
| `ConflictError` | 409 | `conflict` |
| `UnsupportedMediaTypeError` | 415 | `unsupported media type` |
| `DatastoreError` | 500 | `datastore error` |
| `ConnectionError` | 500 | `failed to connect to database` |
| `QueryError` | 500 | `database query failed` |
| `UniqueViolationError` | 409 | `uniqueness violation` |
| `ConstraintViolationError` | 400 | `database constraint violation` |
| `RecordNotFoundError` | 404 | `record not found` |
| `TransactionError` | 500 | `database transaction failed` |

The repository's `#errors` alias resolves to `src/server/errors/errors.ts`. With Bun and dependencies installed, this example runs from the repository root:

```ts
import assert from 'node:assert/strict'

import { ConnectionError, InputValidationError } from '#errors'

const closed = new ConnectionError('Hedra is closed')
const invalid = new InputValidationError('Invalid car', { field: 'year' })
const defaultTitle = new InputValidationError(undefined, 'A year is required')

assert.equal(closed.status, 500)
assert.equal(closed.message, 'Hedra is closed')
assert.equal(invalid.status, 422)
assert.deepEqual(invalid.detail, { field: 'year' })
assert.equal(defaultTitle.title, 'input validation error')
assert.equal(defaultTitle.detail, 'A year is required')
```

## Updating callers

Remove the first numeric argument: `new ConnectionError(500, 'Hedra is closed')` becomes `new ConnectionError('Hedra is closed')`. A title and detail keep their relative order. Use `undefined` as the first argument to keep a class's default title while supplying detail. Numeric status arguments are no longer accepted by the TypeScript constructors.

These errors carry status information; routes still choose how to turn errors into HTTP responses. See [REST controllers](collections.md#rest-operations) and [configuration failures](configuration.md).

Generated resource routes use `ConflictError` for occupied embedded targets and association-blocked deletion, and `UnsupportedMediaTypeError` for a non-JSON request body. Their [public error envelope](web-layer.md#requests-and-responses) preserves client-error statuses while hiding internal failure details.

## Wrapped failures

An existing `HedraError` passes through unchanged, including its status, title, detail and identity. When Hedra wraps another failure, its `cause` holds the original value. `cause` is non-enumerable and is not part of the generated HTTP error envelope. Use it locally to inspect the original validation issues or native database error; do not expose it to clients.

Configuration and collection-definition failures use `ConfigurationError`. Invalid operation input uses `InputValidationError`; output projection uses `OutputValidationError`. Storage failures use the datastore error classes. Unexpected failures use the base `HedraError`. The specific class and cause describe the failure; a `catch` can handle the whole hierarchy through `instanceof HedraError`.

For example, run this from the repository root with Bun and dependencies installed:

```ts
import assert from 'node:assert/strict'

import { HedraError } from '#errors'
import { SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')

try {
  await backend.insert('widgets', { id: 'one' })

  try {
    await backend.insert('widgets', { id: 'one' })
    assert.fail('A duplicate ID must reject')
  } catch (error) {
    assert.ok(error instanceof HedraError)
    assert.ok(error.cause instanceof Error)
    assert.equal(Object.prototype.propertyIsEnumerable.call(error, 'cause'), false)
  }

  assert.deepEqual(await backend.select('widgets'), [{ id: 'one' }])
} finally {
  backend.close()
}
```

The guarantee applies to Hedra-owned operations. Calling `.parse()` on an exported Zod schema directly retains Zod's error contract. Consumer callbacks, custom dependencies and inherited Hono APIs keep their own contracts until an error crosses a Hedra operation. Hedra does not mutate borrowed dependencies or replace their identity. See [the error-boundary decision](adr/0020-hedra-error-boundaries.md).
