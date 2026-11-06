import { expect, expectTypeOf, test } from 'bun:test'

import {
  BadRequestError,
  ConfigurationError,
  ConflictError,
  ConnectionError,
  ConstraintViolationError,
  DatastoreError,
  HedraError,
  InputValidationError,
  OutputValidationError,
  PreconditionFailedError,
  QueryError,
  RecordNotFoundError,
  TransactionError,
  UniqueViolationError,
  UnsupportedMediaTypeError,
} from '#errors'
import { ErrorResponse } from '#hedra.ts'

test('generated error response has a public Zod schema', () => {
  expect(ErrorResponse.parse({ errors: [{ status: 404, title: 'record not found' }] })).toEqual({
    errors: [{ status: 404, title: 'record not found' }],
  })
})

test('HedraError uses status 500 and preserves its title and detail', () => {
  const detail = { reason: 'unavailable' }
  const error = new HedraError('failure', detail)

  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ name: 'HedraError', status: 500, title: 'failure', message: 'failure' })
  expect(error.detail).toBe(detail)
})

const specializedErrors = [
  [ConfigurationError, 500, 'configuration error', false],
  [InputValidationError, 422, 'input validation error', false],
  [OutputValidationError, 500, 'output validation error', false],
  [PreconditionFailedError, 412, 'precondition failed', false],
  [BadRequestError, 400, 'bad request', false],
  [ConflictError, 409, 'conflict', false],
  [UnsupportedMediaTypeError, 415, 'unsupported media type', false],
  [DatastoreError, 500, 'datastore error', true],
  [ConnectionError, 500, 'failed to connect to database', true],
  [QueryError, 500, 'database query failed', true],
  [UniqueViolationError, 409, 'uniqueness violation', true],
  [ConstraintViolationError, 400, 'database constraint violation', true],
  [RecordNotFoundError, 404, 'record not found', true],
  [TransactionError, 500, 'database transaction failed', true],
] as const

for (const [ErrorClass, status, title, datastore] of specializedErrors) {
  test(`${ErrorClass.name} supplies its status and default title`, () => {
    const error = new ErrorClass()

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(HedraError)
    expect(error instanceof DatastoreError).toBe(datastore)
    expect(error).toMatchObject({ name: ErrorClass.name, status, title, message: title })
    expect(error.detail).toBeUndefined()
  })

  test(`${ErrorClass.name} accepts a custom title and optional detail`, () => {
    const objectDetail = { reason: 'unavailable' }
    const custom = new ErrorClass('custom title')
    const stringDetail = new ErrorClass('custom title', 'extra detail')
    const error = new ErrorClass('custom title', objectDetail)

    expect(custom).toMatchObject({ status, title: 'custom title', message: 'custom title', detail: undefined })
    expect(stringDetail.detail).toBe('extra detail')
    expect(error.detail).toBe(objectDetail)
    expect(error.status).toBe(status)
  })
}

test('Error constructor types accept only a title and optional detail', () => {
  expectTypeOf<ConstructorParameters<typeof HedraError>>().toEqualTypeOf<[title: string, detail?: string | object]>()
  expectTypeOf<ConstructorParameters<(typeof specializedErrors)[number][0]>>().toEqualTypeOf<
    [title?: string, detail?: string | object]
  >()
})
