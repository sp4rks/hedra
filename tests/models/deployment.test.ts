import { expect, test } from 'bun:test'

import { Deployment } from '#models'

test('Deployment parses and lowercases a deployment domain', () => {
  expect(Deployment.parse({ deploymentDomain: '  PlatformName.COM  ' })).toEqual({
    deploymentDomain: 'platformname.com',
  })
})

test('Deployment rejects a value that is not a domain', () => {
  expect(Deployment.safeParse({ deploymentDomain: 'not a domain' }).success).toBe(false)
  expect(Deployment.safeParse({ deploymentDomain: 'localhost' }).success).toBe(false)
  expect(Deployment.safeParse({ deploymentDomain: 'platformname.com.' }).success).toBe(false)
  expect(Deployment.safeParse({}).success).toBe(false)
})
