import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'

import { ConfigurationError } from '#errors'
import { Collection, Hedra } from '#hedra.ts'

const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
}

test('new Hedra returns a Hono app', async () => {
  const app = new Hedra({ env: quiet })

  expect(app).toBeInstanceOf(Hedra)
  expect(app).toBeInstanceOf(Hono)

  app.get('/widgets', (context) => context.json({ name: 'widget' }))
  const response = await app.request('/widgets')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ name: 'widget' })
})

test('new Hedra gives each app its own configuration and logger', () => {
  const first = new Hedra({ env: { ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'one.example' } })
  const second = new Hedra({ env: { ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'two.example' } })

  expect(first.config.deploymentDomain).toBe('one.example')
  expect(second.config.deploymentDomain).toBe('two.example')
  expect(first.instanceId).not.toBe(second.instanceId)
  expect(first.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
})

test('new Hedra throws an invalid configuration and leaves the process running', () => {
  let error: unknown

  try {
    new Hedra({ env: { ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'not a domain' } })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ConfigurationError)
  expect(process.exitCode).toBeUndefined()
})

test('new Hedra uses the configured listen port', () => {
  const app = new Hedra({ env: { ...quiet, HEDRA_SERVER_LISTEN_PORT: '8080' } })

  expect(app.port).toBe(8080)
})

test('new Hedra uses the configured listen IP', () => {
  const app = new Hedra({ env: { ...quiet, HEDRA_SERVER_LISTEN_IP: ' 127.0.0.1 ' } })

  expect(app.hostname).toBe('127.0.0.1')
})

test('Collection methods fail before registration', () => {
  const cars = new Collection('cars', z.object({ make: z.string() }))

  expect(() => cars.post({ make: 'Toyota' })).toThrow('registered')
  expect(() => cars.get()).toThrow('registered')
  expect(() => cars.put({ make: 'Toyota' }, { make: 'Honda' })).toThrow('registered')
  expect(() => cars.patch({ make: 'Toyota' }, { make: 'Honda' })).toThrow('registered')
  expect(() => cars.delete({ make: 'Toyota' })).toThrow('registered')
})

test('Collection rejects an invalid name or a non-object model', () => {
  for (const name of ['', 'Cars', '../cars', 'cars/other', '1cars']) {
    expect(() => new Collection(name, z.object({ make: z.string() }))).toThrow()
  }
  expect(() => new Collection('cars', z.string() as never)).toThrow('Zod object')
  expect(
    new Collection(
      'cars-v2_archive',
      z.object({ make: z.string() }).refine(() => true),
    ),
  ).toBeInstanceOf(Collection)
})

test('Register rejects duplicate names and collection reuse across apps', () => {
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', z.object({ make: z.string() }))

  first.register(cars)

  try {
    cars.post({ make: 'Toyota' })
    expect(() => first.register({ name: 'bikes' } as never)).toThrow('Collection')
    first.register(new Collection('bikes', z.object({ make: z.string() })))
    expect(() => first.register(new Collection('cars', z.object({ make: z.string() })))).toThrow()
    expect(() => second.register(cars)).toThrow()
    expect(cars.get()).toEqual([{ make: 'Toyota' }])
  } finally {
    first.close()
    second.close()
  }
})

test('Hedra opens SQLite only when the first collection is registered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const path = join(dir, 'nested', 'db.sqlite')
  const app = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: path } })

  try {
    expect(existsSync(path)).toBe(false)
    app.register(new Collection('cars', z.object({ make: z.string() })))
    expect(existsSync(path)).toBe(true)
  } finally {
    app.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('A failed database open leaves the collection available for registration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: dir } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', z.object({ make: z.string() }))

  try {
    expect(() => first.register(cars)).toThrow()
    second.register(cars)
    expect(cars.post({ make: 'Toyota' })).toEqual({ make: 'Toyota' })
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Close is idempotent and ends the app collection lifecycle', () => {
  const app = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', z.object({ make: z.string() }))

  app.register(cars)
  cars.post({ make: 'Toyota' })
  app.close()
  app.close()
  expect(() => cars.post({ make: 'Honda' })).toThrow()
  expect(() => cars.get()).toThrow()
  expect(() => cars.put({ make: 'Toyota' }, { make: 'Honda' })).toThrow()
  expect(() => cars.patch({ make: 'Toyota' }, { make: 'Honda' })).toThrow()
  expect(() => cars.delete({ make: 'Toyota' })).toThrow()
  expect(() => app.register(new Collection('bikes', z.object({ make: z.string() })))).toThrow()

  const empty = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })

  empty.close()
  expect(() => empty.register(new Collection('cars', z.object({ make: z.string() })))).toThrow()
})

test('Reopening a database preserves registered collection records', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const path = join(dir, 'db.sqlite')
  const schema = z.object({ make: z.string(), details: z.object({ tags: z.array(z.string()) }) })
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: path } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: path } })
  const cars = new Collection('cars', schema)
  const reopened = new Collection('cars', schema)

  try {
    first.register(cars)
    cars.post({ make: 'Toyota', details: { tags: ['hybrid'] } })
    first.close()
    second.register(reopened)
    expect(reopened.get()).toEqual([{ make: 'Toyota', details: { tags: ['hybrid'] } }])
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Registering a collection adds no HTTP routes', async () => {
  const app = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })

  app.register(new Collection('cars', z.object({ make: z.string() })))
  try {
    expect((await app.request('/cars')).status).toBe(404)
    expect((await app.request('/cars', { method: 'POST' })).status).toBe(404)
  } finally {
    app.close()
  }
})
