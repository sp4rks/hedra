import { expect, test } from 'bun:test'

import { RecordFieldConstraints, RecordSchemaConstraints } from '#models'

test('RecordFieldConstraints accepts unique and indexed', () => {
  const both: RecordFieldConstraints = RecordFieldConstraints.parse({ unique: true, indexed: true })
  expect(both).toEqual({ unique: true, indexed: true })
  expect(RecordFieldConstraints.parse({ unique: false })).toEqual({ unique: false })
  expect(RecordFieldConstraints.parse({ indexed: true })).toEqual({ indexed: true })
  expect(RecordFieldConstraints.parse({})).toEqual({})
})

test('RecordFieldConstraints names an unknown key in its error', () => {
  const result = RecordFieldConstraints.safeParse({ unique: true, owner: true })

  expect(result.success).toBe(false)
  if (result.success) return

  expect(result.error.issues.map((issue) => issue.message)).toEqual(['Unrecognized key: "owner"'])
})

test('RecordSchemaConstraints accepts compoundUnique field sets', () => {
  const constraints: RecordSchemaConstraints = RecordSchemaConstraints.parse({
    compoundUnique: [{ fields: ['tenantDomain', 'name'] }, { fields: ['environmentDomain'] }],
  })

  expect(constraints).toEqual({
    compoundUnique: [{ fields: ['tenantDomain', 'name'] }, { fields: ['environmentDomain'] }],
  })
  expect(RecordSchemaConstraints.parse({})).toEqual({})
})

test('RecordSchemaConstraints names an unknown key in its error', () => {
  const result = RecordSchemaConstraints.safeParse({ compoundUnique: [{ fields: ['name'] }], owner: true })

  expect(result.success).toBe(false)
  if (result.success) return

  expect(result.error.issues.map((issue) => issue.message)).toEqual(['Unrecognized key: "owner"'])
})

test('RecordSchemaConstraints rejects a compound key that is not a list of field names', () => {
  expect(RecordSchemaConstraints.safeParse({ compoundUnique: [{ fields: 'tenantDomain' }] }).success).toBe(false)
  expect(RecordSchemaConstraints.safeParse({ compoundUnique: [{ fields: ['name', 1] }] }).success).toBe(false)
  expect(RecordSchemaConstraints.safeParse({ compoundUnique: ['tenantDomain'] }).success).toBe(false)
  expect(RecordSchemaConstraints.safeParse({ compoundUnique: [{}] }).success).toBe(false)
})
