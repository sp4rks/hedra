import { expect, test } from 'bun:test'

import { Environment, Resource, Tenant } from '#hedra.ts'

test('Resource declares indexed ownership while catalogue domains are unique', () => {
  expect(Resource.shape.environmentDomain.meta()?.constraints).toEqual({ indexed: true })
  expect(Tenant.shape.tenantDomain.meta()?.constraints).toEqual({ unique: true })
  expect(Environment.shape.environmentDomain.meta()?.constraints).toEqual({ unique: true })
  expect(Environment.shape.tenantDomain.meta()?.constraints).toEqual({ indexed: true })
  expect(Resource.shape.environmentDomain.parse(' DEV.ACME.HEDRA.LOCAL ')).toBe('dev.acme.hedra.local')
  expect(Object.hasOwn(Tenant.shape, 'environmentDomain')).toBe(false)
})
