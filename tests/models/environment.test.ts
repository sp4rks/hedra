import { expect, test } from 'bun:test'

import { Environment, environmentDomainValidator, RecordFieldConstraints } from '#models'

const resource = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Acme Widgets',
  description: 'A widget company',
  createdAt: '2025-06-01T10:45:29.323Z',
  updatedAt: '2025-06-01T10:45:29.323Z',
}

const environment = {
  ...resource,
  environmentDomain: 'dev.customername.platformname.com',
  tenantDomain: 'customername.platformname.com',
}

test('Environment parses a resource with environment and tenant domains', () => {
  expect(
    Environment.parse({
      ...environment,
      name: '  Acme Widgets  ',
      environmentDomain: '  Dev.CustomerName.PlatformName.COM  ',
      tenantDomain: '  CustomerName.PlatformName.COM  ',
    }),
  ).toEqual(environment)
})

test('Environment requires the Resource fields', () => {
  const missingResource = Environment.safeParse({
    environmentDomain: environment.environmentDomain,
    tenantDomain: environment.tenantDomain,
  })
  expect(missingResource.success).toBe(false)
  if (!missingResource.success) {
    const paths = missingResource.error.issues.map((issue) => issue.path[0])
    expect(paths).toContain('id')
    expect(paths).toContain('name')
    expect(paths).toContain('createdAt')
    expect(paths).toContain('updatedAt')
    expect(paths).not.toContain('description')
  }

  expect(Environment.safeParse(resource).success).toBe(false)
})

test('Environment reports Invalid environment domain and Invalid tenant domain for values that are not domains', () => {
  const result = Environment.safeParse({
    ...environment,
    environmentDomain: 'not a domain',
    tenantDomain: 'localhost',
  })

  expect(result.success).toBe(false)
  if (result.success) return

  expect(result.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: ['environmentDomain'], message: 'Invalid environment domain' }),
      expect.objectContaining({ path: ['tenantDomain'], message: 'Invalid tenant domain' }),
    ]),
  )
})

test('Environment leaves the domain hierarchy to environmentDomainValidator', () => {
  const parsed = Environment.parse({
    ...environment,
    environmentDomain: 'staging.platformname.com',
  })

  expect(parsed.environmentDomain).toBe('staging.platformname.com')
  expect(environmentDomainValidator(parsed.environmentDomain, parsed.tenantDomain)).toBe(false)
  expect(environmentDomainValidator(environment.environmentDomain, environment.tenantDomain)).toBe(true)
})

test('Environment marks environmentDomain unique and tenantDomain indexed', () => {
  expect(RecordFieldConstraints.parse(Environment.shape.environmentDomain.meta()?.constraints)).toEqual({
    unique: true,
  })
  expect(RecordFieldConstraints.parse(Environment.shape.tenantDomain.meta()?.constraints)).toEqual({
    indexed: true,
  })
})

test('Environment derives variants with omit, pick and partial', () => {
  const withoutIdentity = Environment.omit({ id: true, createdAt: true, updatedAt: true })
  expect(
    withoutIdentity.parse({
      name: 'Acme Widgets',
      description: null,
      environmentDomain: environment.environmentDomain,
      tenantDomain: environment.tenantDomain,
    }),
  ).toEqual({
    name: 'Acme Widgets',
    description: null,
    environmentDomain: environment.environmentDomain,
    tenantDomain: environment.tenantDomain,
  })

  const named = Environment.pick({ name: true, environmentDomain: true })
  expect(
    named.parse({
      name: '  Acme Widgets  ',
      environmentDomain: '  Dev.CustomerName.PlatformName.COM ',
    }),
  ).toEqual({
    name: 'Acme Widgets',
    environmentDomain: environment.environmentDomain,
  })

  const draft = Environment.partial()
  expect(draft.parse({})).toEqual({})
  expect(draft.parse({ name: '  Acme Widgets  ' })).toEqual({ name: 'Acme Widgets' })
  expect(draft.safeParse({ environmentDomain: 'not a domain' }).success).toBe(false)
})
