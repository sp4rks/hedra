import { expect, test } from 'bun:test'

import { RecordFieldConstraints, Tenant } from '#models'

const resource = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Acme Widgets',
  description: 'A widget company',
  createdAt: '2025-06-01T10:45:29.323Z',
  updatedAt: '2025-06-01T10:45:29.323Z',
}

const tenant = {
  ...resource,
  tenantDomain: 'customername.platformname.com',
}

test('Tenant parses a resource with a tenant domain', () => {
  expect(
    Tenant.parse({
      ...tenant,
      name: '  Acme Widgets  ',
      description: '  A widget company  ',
      tenantDomain: '  CustomerName.PlatformName.COM  ',
    }),
  ).toEqual(tenant)
})

test('Tenant requires the Resource fields', () => {
  const missingResource = Tenant.safeParse({ tenantDomain: tenant.tenantDomain })
  expect(missingResource.success).toBe(false)
  if (!missingResource.success) {
    const paths = missingResource.error.issues.map((issue) => issue.path[0])
    expect(paths).toContain('id')
    expect(paths).toContain('name')
    expect(paths).toContain('createdAt')
    expect(paths).toContain('updatedAt')
    expect(paths).not.toContain('description')
  }

  expect(Tenant.safeParse(resource).success).toBe(false)
})

test('Tenant reports Invalid tenant domain for a value that is not a domain', () => {
  for (const tenantDomain of ['not a domain', 'localhost', '', 'customername.platformname.com.']) {
    const result = Tenant.safeParse({ ...tenant, tenantDomain })
    expect(result.success).toBe(false)
    if (result.success) continue

    expect(result.error.issues).toEqual([
      expect.objectContaining({ path: ['tenantDomain'], message: 'Invalid tenant domain' }),
    ])
  }
})

test('Tenant marks tenantDomain unique', () => {
  expect(RecordFieldConstraints.parse(Tenant.shape.tenantDomain.meta()?.constraints)).toEqual({ unique: true })
})
