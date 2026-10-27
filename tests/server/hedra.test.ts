import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { ConfigurationError } from '#errors'
import { Hedra } from '#hedra.ts'

const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
}

test('new Hedra returns a Hono app', async () => {
  const app = new Hedra(quiet)

  expect(app).toBeInstanceOf(Hedra)
  expect(app).toBeInstanceOf(Hono)

  app.get('/widgets', (context) => context.json({ name: 'widget' }))
  const response = await app.request('/widgets')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ name: 'widget' })
})

test('new Hedra gives each app its own configuration and logger', () => {
  const first = new Hedra({ ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'one.example' })
  const second = new Hedra({ ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'two.example' })

  expect(first.config.deploymentDomain).toBe('one.example')
  expect(second.config.deploymentDomain).toBe('two.example')
  expect(first.config.instanceId).not.toBe(second.config.instanceId)
  expect(first.log.bindings().instanceId).toBe(first.config.instanceId)
  expect(second.log.bindings().instanceId).toBe(second.config.instanceId)
})

test('new Hedra throws an invalid configuration and leaves the process running', () => {
  let error: unknown
  try {
    new Hedra({ ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'not a domain' })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(process.exitCode).toBeUndefined()
})

test('new Hedra uses the configured port', () => {
  const app = new Hedra({ ...quiet, HEDRA_SERVER_PORT: '8080' })

  expect(app.port).toBe(8080)
})

test('new Hedra applies the configured log level', () => {
  const app = new Hedra({ ...quiet, HEDRA_SERVER_LOG_LEVEL: 'debug' })

  expect(app.log.level).toBe('debug')
})
