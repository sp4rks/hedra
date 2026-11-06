# Errors

Each error class sets its HTTP status internally. Constructors accept a title and optional detail; callers do not pass a status.

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
