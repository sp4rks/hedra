import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadServerConfig } from '#config'
import { ConfigurationError } from '#errors'

test('loadServerConfig uses Hedra defaults when variables are unset', async () => {
  const config = await loadServerConfig({})

  expect(config.deploymentDomain).toBe('hedra.local')
  expect(config.deploymentApiDomain).toBe('deployment.hedra.local')
  expect(config.deploymentDocsDomain).toBe('docs.hedra.local')
  expect(config.serverEnv).toBe('dev')
  expect(config.serverSilentStartup).toBe('false')
  expect(config.serverLogType).toBe('pino')
  expect(config.serverLogLevel).toBe('info')
  expect(config.serverHttpLogEnabled).toBe('true')
  expect(config.serverRequestTimeout).toBe('30000')
  expect(config.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
})

test('loadServerConfig prefers a trimmed environment value over the default', async () => {
  const config = await loadServerConfig({
    HEDRA_DEPLOYMENT_DOMAIN: '  example.com  ',
    HEDRA_SERVER_ENV: 'prod',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.deploymentDomain).toBe('example.com')
  expect(config.serverEnv).toBe('prod')
  expect(config.serverSilentStartup).toBe('true')
  expect(config.deploymentApiDomain).toBe('deployment.hedra.local')
})

test('loadServerConfig treats a blank environment value as unset', async () => {
  const config = await loadServerConfig({
    HEDRA_SERVER_ENV: '   ',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.serverEnv).toBe('dev')
})

test('loadServerConfig rejects an invalid deployment domain', async () => {
  const load = () =>
    loadServerConfig({
      HEDRA_DEPLOYMENT_DOMAIN: 'not a domain',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

  await expect(load()).rejects.toBeInstanceOf(ConfigurationError)
  await expect(load()).rejects.toMatchObject({
    detail: 'HEDRA_DEPLOYMENT_DOMAIN has invalid value: not a domain',
  })
})

test('loadServerConfig rejects a server env outside the allowed set', async () => {
  const config = loadServerConfig({
    HEDRA_SERVER_ENV: 'staging',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  await expect(config).rejects.toMatchObject({
    detail: 'HEDRA_SERVER_ENV has invalid value: staging',
  })
})

test('loadServerConfig rejects a request timeout outside 1 to 300000', async () => {
  const config = loadServerConfig({
    HEDRA_SERVER_REQUEST_TIMEOUT: '0',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  await expect(config).rejects.toMatchObject({
    detail: 'HEDRA_SERVER_REQUEST_TIMEOUT has invalid value: 0',
  })
})

test('loadServerConfig reads unset variables from HEDRA_ENV_FILE', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')
  await Bun.write(envPath, 'HEDRA_SERVER_ENV=nonprod\nHEDRA_DEPLOYMENT_DOMAIN=from-file.example\n')

  try {
    const config = await loadServerConfig({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverEnv).toBe('nonprod')
    expect(config.deploymentDomain).toBe('from-file.example')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadServerConfig uses defaults when HEDRA_ENV_FILE is missing', async () => {
  const config = await loadServerConfig({
    HEDRA_ENV_FILE: '/tmp/hedra-config-missing.env',
    HEDRA_SERVER_SILENT_STARTUP: 'true',
  })

  expect(config.serverEnv).toBe('dev')
  expect(config.deploymentDomain).toBe('hedra.local')
})

test('loadServerConfig keeps an explicit value when HEDRA_ENV_FILE sets the same variable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hedra-config-'))
  const envPath = join(dir, 'app.env')
  await Bun.write(envPath, 'HEDRA_SERVER_ENV=prod\n')

  try {
    const config = await loadServerConfig({
      HEDRA_ENV_FILE: envPath,
      HEDRA_SERVER_ENV: 'dev',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
    })

    expect(config.serverEnv).toBe('dev')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
