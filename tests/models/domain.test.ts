import { expect, test } from 'bun:test'

import { Domain, deploymentDomainValidator, environmentDomainValidator, tenantDomainValidator } from '#models'

const deploymentDomain = 'platformname.com'
const tenantDomain = 'customername.platformname.com'
const environmentDomain = 'dev.customername.platformname.com'
const reservedDomains = ['platform.platformname.com', 'docs.platformname.com']

test('Domain accepts a hostname', () => {
  expect(Domain.parse(deploymentDomain)).toBe(deploymentDomain)
  expect(Domain.parse(tenantDomain)).toBe(tenantDomain)
  expect(Domain.parse(environmentDomain)).toBe(environmentDomain)
})

test('Domain trims and lowercases a hostname', () => {
  expect(Domain.parse('  PlatformName.COM  ')).toBe(deploymentDomain)
  expect(Domain.parse('  Dev.CustomerName.PlatformName.COM ')).toBe(environmentDomain)
})

test('Domain rejects a value that is not a hostname', () => {
  for (const value of ['not a domain', 'localhost', 'platformname', 'platformname.com.', 'platformname..com', '']) {
    expect(Domain.safeParse(value).success).toBe(false)
  }
})

test('deploymentDomainValidator accepts the deployment domain in any case', () => {
  expect(deploymentDomainValidator('PlatformName.COM', 'platformname.com')).toBe(true)
  expect(deploymentDomainValidator('  platformname.com  ', '  PLATFORMNAME.COM  ')).toBe(true)
})

test('deploymentDomainValidator rejects any other domain', () => {
  expect(deploymentDomainValidator(tenantDomain, deploymentDomain)).toBe(false)
  expect(deploymentDomainValidator('other.com', deploymentDomain)).toBe(false)
  expect(deploymentDomainValidator(deploymentDomain, 'other.com')).toBe(false)
  expect(deploymentDomainValidator('not a domain', deploymentDomain)).toBe(false)
  expect(deploymentDomainValidator(deploymentDomain, 'not a domain')).toBe(false)
})

test('tenantDomainValidator accepts one label under the deployment domain in any case', () => {
  expect(tenantDomainValidator('CustomerName.PlatformName.COM', 'PlatformName.com', reservedDomains)).toBe(true)
  expect(tenantDomainValidator('  customername.platformname.com  ', '  PLATFORMNAME.COM  ', reservedDomains)).toBe(true)
})

test('tenantDomainValidator rejects the deployment domain itself', () => {
  expect(tenantDomainValidator(deploymentDomain, deploymentDomain, reservedDomains)).toBe(false)
  expect(tenantDomainValidator('PlatformName.COM', 'platformname.com', reservedDomains)).toBe(false)
})

test("tenantDomainValidator rejects a domain that only shares the deployment domain's suffix", () => {
  expect(tenantDomainValidator('customerplatformname.com', deploymentDomain, reservedDomains)).toBe(false)
  expect(tenantDomainValidator('CustomerPlatformName.COM', 'platformname.com', [])).toBe(false)
})

test('tenantDomainValidator rejects more than one label under the deployment domain', () => {
  expect(tenantDomainValidator(environmentDomain, deploymentDomain, reservedDomains)).toBe(false)
  expect(tenantDomainValidator('Dev.CustomerName.PlatformName.COM', 'platformname.com', reservedDomains)).toBe(false)
})

test('tenantDomainValidator rejects a reserved domain in any case', () => {
  expect(tenantDomainValidator('Platform.PlatformName.COM', deploymentDomain, reservedDomains)).toBe(false)
  expect(tenantDomainValidator('docs.platformname.com', deploymentDomain, ['DOCS.PlatformName.COM'])).toBe(false)
  expect(
    tenantDomainValidator('  PLATFORM.platformname.com  ', 'platformname.com', ['platform.platformname.com']),
  ).toBe(false)
})

test('tenantDomainValidator rejects a value that is not a domain', () => {
  for (const value of ['not a domain', 'localhost', '', 'customername', 'customername.platformname.com.', '   ']) {
    expect(tenantDomainValidator(value, deploymentDomain, reservedDomains)).toBe(false)
  }

  expect(tenantDomainValidator(tenantDomain, 'not a domain', reservedDomains)).toBe(false)
})

test('environmentDomainValidator accepts one label under the tenant domain in any case', () => {
  expect(environmentDomainValidator('Dev.CustomerName.PlatformName.COM', 'CustomerName.PlatformName.com')).toBe(true)
  expect(environmentDomainValidator('  dev.customername.platformname.com  ', '  CUSTOMERNAME.PLATFORMNAME.COM  ')).toBe(
    true,
  )
})

test('environmentDomainValidator rejects the tenant domain itself', () => {
  expect(environmentDomainValidator(tenantDomain, tenantDomain)).toBe(false)
  expect(environmentDomainValidator('CustomerName.PlatformName.COM', 'customername.platformname.com')).toBe(false)
})

test('environmentDomainValidator rejects a domain outside the tenant', () => {
  expect(environmentDomainValidator('staging.platformname.com', tenantDomain)).toBe(false)
  expect(environmentDomainValidator('dev.othername.platformname.com', tenantDomain)).toBe(false)
  expect(environmentDomainValidator('dev.customername.other.com', tenantDomain)).toBe(false)
})

test('environmentDomainValidator rejects more than one label under the tenant domain', () => {
  expect(environmentDomainValidator('a.dev.customername.platformname.com', tenantDomain)).toBe(false)
  expect(environmentDomainValidator('A.Dev.CustomerName.PlatformName.COM', 'customername.platformname.com')).toBe(false)
})
