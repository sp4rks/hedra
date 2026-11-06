import { expect, test } from 'bun:test'

import { ErrorResponse } from '#hedra.ts'

test('generated error response has a public Zod schema', () => {
  expect(ErrorResponse.parse({ errors: [{ status: 404, title: 'record not found' }] })).toEqual({
    errors: [{ status: 404, title: 'record not found' }],
  })
})
