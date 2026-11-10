import { expect, test } from 'bun:test'

import { Tenant, TenantChanges, TenantInput } from '#hedra.ts'

test('TenantInput normalises creation attributes and rejects unknown or managed fields', () => {
  const input = { name: ' Acme ', tenantDomain: ' ACME.HEDRA.LOCAL ' }

  expect(TenantInput.parse(input)).toEqual({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

  for (const key of ['id', 'createdAt', 'updatedAt', 'unknown']) {
    expect(TenantInput.safeParse({ ...input, [key]: undefined }).success).toBe(false)
    expect(TenantInput.safeParse({ ...input, [key]: 'value' }).success).toBe(false)
  }
})

test('TenantChanges normalises names and rejects domain updates and managed fields', () => {
  expect(TenantChanges.parse({ name: ' Acme ' })).toEqual({ name: 'Acme' })
  expect(TenantChanges.parse({})).toEqual({})

  for (const key of ['tenantDomain', 'id', 'createdAt', 'updatedAt', 'unknown']) {
    expect(TenantChanges.safeParse({ name: 'Acme', [key]: undefined }).success).toBe(false)
    expect(TenantChanges.safeParse({ name: 'Acme', [key]: 'value' }).success).toBe(false)
  }
})

test('Tenant requires a canonical DNS domain', () => {
  const tenant = {
    id: 'd0b85c43-5c98-4433-9d8c-94cd3c57b616',
    createdAt: '2026-11-07T00:00:00.000Z',
    updatedAt: '2026-11-07T00:00:00.000Z',
    name: ' Acme ',
  }

  expect(Tenant.safeParse(tenant).success).toBe(false)
  expect(Tenant.parse({ ...tenant, tenantDomain: ' ACME.HEDRA.LOCAL ' })).toMatchObject({
    name: 'Acme',
    tenantDomain: 'acme.hedra.local',
  })

  for (const tenantDomain of ['https://acme.hedra.local', 'acme.hedra.local:3000', '-acme.hedra.local', 'bad domain']) {
    expect(Tenant.safeParse({ ...tenant, tenantDomain }).success).toBe(false)
  }
})
