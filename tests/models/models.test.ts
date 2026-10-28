import { expect, test } from 'bun:test'

import * as hedra from '#hedra.ts'
import * as models from '#models'

const exportedModels = [
  'Resource',
  'Domain',
  'Deployment',
  'Tenant',
  'Environment',
  'RecordFieldConstraints',
  'RecordSchemaConstraints',
  'deploymentDomainValidator',
  'tenantDomainValidator',
  'environmentDomainValidator',
] as const

test('hedra exports every model, validator and constraint schema from #models', () => {
  const fromHedra = hedra as Record<string, unknown>
  const fromModels = models as Record<string, unknown>

  expect(Object.keys(fromModels)).toEqual(expect.arrayContaining([...exportedModels]))

  for (const name of Object.keys(fromModels)) {
    expect(fromHedra[name]).toBe(fromModels[name])
  }

  const domain: hedra.Domain = 'platformname.com'
  const resource: hedra.Resource = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Acme Widgets',
    createdAt: '2025-06-01T10:45:29.323Z',
    updatedAt: '2025-06-01T10:45:29.323Z',
  }
  const deployment: hedra.Deployment = { deploymentDomain: domain }
  const tenant: hedra.Tenant = { ...resource, tenantDomain: 'customername.platformname.com' }
  const environment: hedra.Environment = {
    ...tenant,
    environmentDomain: 'dev.customername.platformname.com',
  }
  const fieldConstraints: hedra.RecordFieldConstraints = { unique: true }
  const schemaConstraints: hedra.RecordSchemaConstraints = { compoundUnique: [{ fields: ['name'] }] }

  expect(deployment.deploymentDomain).toBe(domain)
  expect(tenant.tenantDomain).toBe('customername.platformname.com')
  expect(environment.environmentDomain).toBe('dev.customername.platformname.com')
  expect(fieldConstraints.unique).toBe(true)
  expect(schemaConstraints.compoundUnique?.[0]?.fields).toEqual(['name'])
})
