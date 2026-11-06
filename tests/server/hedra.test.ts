import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Backend } from '#hedra.ts'
import { ConfigurationError } from '#errors'
import { Collection, ConfigStore, Controller, Hedra, Resource, SqliteBackend } from '#hedra.ts'

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

test.each([
  ['', 'info', false],
  ['false', 'info', false],
  ['true', 'info', true],
  ['true', 'warn', false],
])(
  'collection registration logging with HEDRA_SERVER_PRINT_ROUTES=%s at %s level',
  (value, level, logsRegistration) => {
    const dir = mkdtempSync(join(tmpdir(), 'hedra-registration-'))
    const example = join(import.meta.dir, '../../examples/02-models.ts')
    const script = `import hedra from ${JSON.stringify(example)}; hedra.close()`

    try {
      const proc = Bun.spawnSync([process.execPath, '--no-env-file', '-e', script], {
        cwd: dir,
        env: {
          HEDRA_SERVER_PRINT_ROUTES: value,
          HEDRA_SERVER_SILENT_STARTUP: 'true',
          HEDRA_SERVER_LOG_LEVEL: level,
          HEDRA_SERVER_LOG_FORMAT: 'json',
          HEDRA_SQLITE_PATH: ':memory:',
        },
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 5000,
      })
      const output = proc.stdout.toString()

      expect(proc.exitCode).toBe(0)
      expect(proc.stderr.toString()).toBe('')
      if (logsRegistration) {
        expect(JSON.parse(output).msg).toBe('Registering collection: cars')
      } else {
        expect(output).toBe('')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

test('registration retains duplicate-name and instance-reuse checks', async () => {
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const model = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', model)

  first.register(cars)

  try {
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(() => first.register({ name: 'bikes' } as never)).toThrow('Collection')
    first.register(new Collection('bikes', model))
    expect(() => first.register(new Collection('cars', model))).toThrow()
    expect(() => second.register(cars)).toThrow()
    expect(await cars.controller.list()).toEqual([car])
  } finally {
    first.close()
    second.close()
  }
})

test('Hedra lazily owns its default SQLite backend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const path = join(dir, 'nested', 'db.sqlite')
  const model = Resource.extend({ make: z.string() })
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: path } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: path } })
  const cars = new Collection('cars', model)
  const reopened = new Collection('cars', model)

  try {
    expect(existsSync(path)).toBe(false)
    first.register(cars)
    expect(existsSync(path)).toBe(true)
    const car = await cars.controller.create({ make: 'Toyota' })
    const saved = cars.controller

    first.close()
    await expect(saved.get(car.id)).rejects.toThrow()
    second.register(reopened)
    expect(await reopened.controller.get(car.id)).toEqual(car)
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed registration leaves a collection available for a later successful registration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const first = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: dir } })
  const second = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  try {
    expect(() => first.register(cars)).toThrow()
    expect(() => cars.controller).toThrow('registered')
    second.register(cars)
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(await cars.controller.get(car.id)).toEqual(car)
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a throwing controller constructor leaves the collection available for registration', async () => {
  const model = Resource.extend({ make: z.string() })
  let failing = true

  class CustomController extends Controller<typeof model> {
    /** Deliberately fails the first construction. */
    constructor(name: string, schema: typeof model, backend: Backend) {
      super(name, schema, backend)
      if (failing) throw new Error('constructor failed')
    }
  }

  const app = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', model, CustomController)

  try {
    expect(() => app.register(cars)).toThrow('constructor failed')
    expect(() => cars.controller).toThrow('registered')
    failing = false
    app.register(cars)
    const car = await cars.controller.create({ make: 'Toyota' })

    expect(await cars.controller.get(car.id)).toEqual(car)
  } finally {
    app.close()
  }
})

test('Hedra.close invalidates saved controller references without closing a borrowed backend', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore(backend)
  const first = new Hedra({ env: quiet, backend })
  const second = new Hedra({ env: quiet, backend })
  const model = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', model)
  const otherCars = new Collection('cars', model)

  try {
    first.register(cars)
    second.register(otherCars)
    const saved = cars.controller
    const car = await saved.create({ make: 'Toyota' })
    const tenant = await config.tenants.create({ name: 'Acme' })

    first.close()
    first.close()
    await expect(saved.create({ make: 'Honda' })).rejects.toThrow()
    await expect(saved.get(car.id)).rejects.toThrow()
    await expect(saved.list()).rejects.toThrow()
    await expect(saved.update(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(saved.replace(car.id, { make: 'Honda' })).rejects.toThrow()
    await expect(saved.delete(car.id)).rejects.toThrow()
    expect(() => first.register(new Collection('bikes', model))).toThrow()
    expect(await otherCars.controller.get(car.id)).toEqual(car)
    expect(await config.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    first.close()
    second.close()
    backend.close()
  }
})

test('collection registration records endpoint metadata without adding HTTP routes', async () => {
  const app = new Hedra({ env: { ...quiet, HEDRA_SQLITE_PATH: ':memory:' } })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  app.get('/existing', (context) => context.text('ok'))
  app.register(cars)
  try {
    expect(cars.endpoint).toBe('/cars')
    expect((await app.request('/cars')).status).toBe(404)
    expect((await app.request('/cars', { method: 'POST' })).status).toBe(404)
    expect((await app.request('/existing')).status).toBe(200)
  } finally {
    app.close()
  }
})
