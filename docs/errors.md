# Errors

Expected validation and business-rule failures use explicit `HedraError` subclasses. Unexpected failures from dependencies, callbacks, the filesystem and SQLite propagate unchanged. Each Hedra error class sets its HTTP status internally. Constructors accept a title and optional detail; callers do not pass a status.

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

The repository's `#errors` alias resolves to `src/server/errors.ts`. With Bun and dependencies installed, this example runs from the repository root:

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

Generated resource routes use `ConflictError` for association-blocked deletion and `UnsupportedMediaTypeError` for a non-JSON request body. Their [public error envelope](web-layer.md#requests-and-responses) preserves client-error statuses while hiding internal failure details.

## Validation and unexpected failures

Use `safeParse` at a validation boundary, then raise the appropriate error explicitly if the result fails. Use the parsed data afterward so normalisation and defaults take effect. Input failures use `InputValidationError`; invalid stored/projected resources use `OutputValidationError`; invalid environment or collection definitions use `ConfigurationError`. Generic backend contract violations use the existing datastore error classes. Validation issues can be supplied as error detail.

For example, run this from the repository root with Bun and dependencies installed:

```ts
import assert from 'node:assert/strict'

import { InputValidationError } from '#errors'
import { Tenant } from '#hedra.ts'

const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

/** Validates tenant attributes before using their normalised values. */
function validateTenant(input: unknown) {
  const result = TenantInput.safeParse(input)

  if (!result.success) throw new InputValidationError('Invalid tenant', result.error.issues)

  return result.data
}

assert.deepEqual(validateTenant({ name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' }), {
  name: 'Acme',
  tenantDomain: 'acme.hedra.local',
})
assert.throws(() => validateTenant({ name: '', tenantDomain: 'acme.hedra.local' }), InputValidationError)
```

Do not add a `try/catch` merely to turn every thrown value into a Hedra error. Unexpected failures retain their original identity, type, stack and any native cause. An existing Hedra error also passes through unchanged. A thrown exception inside a custom refinement or transform is unexpected; `safeParse` does not turn that exception into a validation result. Direct programmatic callers handle the errors relevant to their operation and cannot assume every failure is a `HedraError`.

Native JSON serialisation failures also propagate: programmatic values containing cycles or `BigInt` can throw a native `TypeError` before schema validation. They are still rejected before persistence; there is no additional cycle-aware validator.

Keep catches that perform useful recovery, translate malformed JSON into an expected request error, or form a safe HTTP response. Keep transaction rollback, session invalidation and connection cleanup even when removing normalising catches. For example, a callback failure propagates unchanged and rolls back its writes:

```ts
import assert from 'node:assert/strict'

import { SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const failure = new Error('The callback failed')

try {
  await backend.insert('widgets', { id: 'existing' })
  await assert.rejects(
    backend.transaction((transaction) => {
      transaction.insert('widgets', { id: 'temporary' })
      throw failure
    }),
    (error) => error === failure,
  )
  assert.deepEqual(await backend.select('widgets'), [{ id: 'existing' }])
} finally {
  backend.close()
}
```

Generated resource routes retain their existing response boundary: recognised Hedra client errors preserve their public status, title and JSON-compatible detail; all internal or unexpected failures become a generic 500 envelope. Exception messages, stacks and native causes are not exposed. This change does not install a global error handler for custom Hono routes, startup or background work; those callers need their own error handling. See [the explicit-error decision](adr/0025-explicit-validation-errors.md).
