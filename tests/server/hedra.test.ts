import { expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { z } from 'zod'

import type { Backend, ControllerInterface } from '#hedra.ts'
import { ConnectionError, HedraError } from '#errors'
import {
  BaseController,
  Collection,
  Config,
  ConfigStore,
  Hedra,
  JsonApiListResponse,
  JsonApiResponse,
  Resource,
  SqliteBackend,
} from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = {
  HEDRA_SERVER_SILENT_STARTUP: 'true',
  HEDRA_SERVER_LOG_LEVEL: 'silent',
}

test('new Hedra returns a Hono app', async () => {
  const app = new Hedra({ config: new Config(quiet) })

  expect(app).toBeInstanceOf(Hedra)
  expect(app).toBeInstanceOf(Hono)

  app.get('/widgets', (context) => context.json({ name: 'widget' }))
  const response = await request(app, '/widgets')

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ name: 'widget' })
})

test('Hedra keeps separate supplied configurations and app identities', () => {
  const first = new Hedra({ config: new Config({ ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'one.example' }) })
  const second = new Hedra({ config: new Config({ ...quiet, HEDRA_DEPLOYMENT_DOMAIN: 'two.example' }) })

  expect(first.config.deploymentDomain).toBe('one.example')
  expect(second.config.deploymentDomain).toBe('two.example')
  expect(first.instanceId).not.toBe(second.instanceId)
  expect(first.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
})

test('new Hedra uses the configured listen port', () => {
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SERVER_LISTEN_PORT: '8080' }) })

  expect(app.port).toBe(8080)
})

test('new Hedra uses the configured listen IP', () => {
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SERVER_LISTEN_IP: ' 127.0.0.1 ' }) })

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
    const entry = join(import.meta.dir, '../../src/hedra.ts')
    const script = `import { Hedra, Collection, Resource } from ${JSON.stringify(entry)};
      const app = new Hedra(); app.register(new Collection('cars', Resource)); app.close()`

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

/** Adds explicit test routes using a collection's registered controller. */
function mountCars(app: Hedra, cars: Collection, controller: ControllerInterface = cars.controller): void {
  app.scoped.post('/test/cars', async (context) =>
    context.json(await controller.create(context, cars, { make: 'Toyota' })),
  )
  app.scoped.get('/test/cars', async (context) =>
    context.json(await controller.list(context, cars, 'http://localhost/test/cars')),
  )
  app.scoped.get('/test/cars/:id', async (context) =>
    context.json(await controller.id(context, cars, z.string().parse(context.req.param('id')))),
  )
  app.scoped.patch('/test/cars/:id', async (context) =>
    context.json(await controller.update(context, cars, { make: 'Honda' }, z.string().parse(context.req.param('id')))),
  )
  app.scoped.delete('/test/cars/:id', async (context) => {
    await controller.delete(context, cars, z.string().parse(context.req.param('id')))

    return context.body(null, 204)
  })
  app.onError((_error, context) => context.text('failed', 500))
}

test('registration retains duplicate-name and instance-reuse checks', async () => {
  const first = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: ':memory:' }) })
  const second = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: ':memory:' }) })
  const model = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', model)

  first.register(cars)
  first.register(new Collection('bikes', model))
  mountCars(first, cars)

  try {
    const car = JsonApiResponse.parse(await (await request(first, '/test/cars', { method: 'POST' })).json()).data

    expect(() => first.register({ name: 'bikes' } as never)).toThrow('Collection')
    expect(() => first.register(new Collection('cars', model))).toThrow()
    expect(() => second.register(cars)).toThrow()
    expect(JsonApiListResponse.parse(await (await request(first, '/test/cars')).json()).data).toEqual([car])
  } finally {
    first.close()
    second.close()
  }
})

test('Hedra lazily owns its default SQLite backend', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const path = join(dir, 'nested', 'db.sqlite')
  const model = Resource.extend({ make: z.string() })
  const first = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }) })
  const second = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: path }) })
  const cars = new Collection('cars', model)
  const reopened = new Collection('cars', model)

  try {
    expect(existsSync(path)).toBe(false)
    first.register(cars)
    mountCars(first, cars)
    expect(existsSync(path)).toBe(true)
    const car = JsonApiResponse.parse(await (await request(first, '/test/cars', { method: 'POST' })).json()).data
    const id = z.uuid().parse(car.id)

    first.close()
    expect((await request(first, `/test/cars/${id}`)).status).toBe(500)
    second.register(reopened)
    mountCars(second, reopened)
    expect(JsonApiResponse.parse(await (await request(second, `/test/cars/${id}`)).json()).data).toEqual(car)
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed registration leaves a collection available for a later successful registration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hedra-sqlite-'))
  const first = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: dir }) })
  const second = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: ':memory:' }) })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  try {
    expect(() => first.register(cars)).toThrow()
    expect(() => cars.controller).toThrow('registered')
    second.register(cars)
    mountCars(second, cars)
    const car = JsonApiResponse.parse(await (await request(second, '/test/cars', { method: 'POST' })).json()).data
    const id = z.uuid().parse(car.id)

    expect(JsonApiResponse.parse(await (await request(second, `/test/cars/${id}`)).json()).data).toEqual(car)
  } finally {
    first.close()
    second.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a throwing controller constructor leaves the collection available for registration', async () => {
  const model = Resource.extend({ make: z.string() })
  const cause = new Error('constructor failed')
  let failing = true

  class CustomController extends BaseController {
    /** Deliberately fails the first construction. */
    constructor(backend: Backend) {
      super(backend)
      if (failing) throw cause
    }
  }

  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: ':memory:' }) })
  const cars = new Collection('cars', model, { controller: CustomController })

  try {
    let caught: unknown

    try {
      app.register(cars)
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(cause)
    expect(() => cars.controller).toThrow(HedraError)
    expect(() => cars.controller).toThrow('registered')
    failing = false
    app.register(cars)
    mountCars(app, cars)
    const car = JsonApiResponse.parse(await (await request(app, '/test/cars', { method: 'POST' })).json()).data
    const id = z.uuid().parse(car.id)

    expect(JsonApiResponse.parse(await (await request(app, `/test/cars/${id}`)).json()).data).toEqual(car)
  } finally {
    app.close()
  }
})

test('Hedra.close invalidates saved controller references without closing a borrowed backend', async () => {
  const backend = new SqliteBackend(':memory:')
  const config = new ConfigStore({ backend })
  const first = new Hedra({ config: new Config(quiet), backend })
  const second = new Hedra({ config: new Config(quiet), backend })
  const model = Resource.extend({ make: z.string() })
  const cars = new Collection('cars', model)
  const otherCars = new Collection('cars', model)
  const errors: Error[] = []

  try {
    first.register(cars)
    second.register(otherCars)
    const saved = cars.controller

    mountCars(first, cars, saved)
    mountCars(second, otherCars)
    const car = JsonApiResponse.parse(await (await request(first, '/test/cars', { method: 'POST' })).json()).data
    const id = z.uuid().parse(car.id)
    const tenant = await config.tenants.create({ name: 'Acme', tenantDomain: 'acme.hedra.local' })

    const context = await scopedContext('http://localhost/cars')

    first.close()
    first.close()
    expect((await request(first, '/test/cars', { method: 'POST' })).status).toBe(500)
    expect((await request(first, `/test/cars/${id}`)).status).toBe(500)
    expect((await request(first, '/test/cars')).status).toBe(500)
    expect((await request(first, `/test/cars/${id}`, { method: 'PATCH' })).status).toBe(500)
    expect((await request(first, `/test/cars/${id}`, { method: 'DELETE' })).status).toBe(500)
    const operations = [
      () => saved.create(context, cars, { make: 'Toyota' }),
      () => saved.id(context, cars, id),
      () => saved.list(context, cars, context.req.url),
      () => saved.update(context, cars, { make: 'Honda' }, id),
      () => saved.delete(context, cars, id),
    ]

    for (const operation of operations) {
      try {
        await operation()
      } catch (error) {
        if (error instanceof Error) errors.push(error)
      }
    }
    expect(errors).toHaveLength(5)

    for (const error of errors) {
      expect(error).toBeInstanceOf(ConnectionError)
      expect(error).toMatchObject({
        status: 500,
        title: 'Datastore connection is closed',
        message: 'Datastore connection is closed',
      })
    }
    expect(errors[0]).toHaveProperty('detail', undefined)
    expect(() => first.register(new Collection('bikes', model))).toThrow()
    expect(JsonApiResponse.parse(await (await request(second, `/test/cars/${id}`)).json()).data).toEqual(car)
    expect(await config.tenants.get(tenant.id)).toEqual(tenant)
  } finally {
    first.close()
    second.close()
    backend.close()
  }
})

test('collection registration adds HTTP routes and retains custom routes', async () => {
  const app = new Hedra({ config: new Config({ ...quiet, HEDRA_SQLITE_PATH: ':memory:' }) })
  const cars = new Collection('cars', Resource.extend({ make: z.string() }))

  app.get('/existing', (context) => context.text('ok'))
  app.register(cars)
  app.register(new Collection('bikes', Resource.extend({ make: z.string() })))
  try {
    expect(cars.endpoint).toBe('/cars')
    expect((await request(app, '/cars')).status).toBe(200)
    expect((await request(app, '/cars', { method: 'POST' })).status).toBe(415)
    expect((await request(app, '/existing')).status).toBe(200)
    expect((await request(app, '/bikes')).status).toBe(200)
  } finally {
    app.close()
  }
})

test('transaction sessions honor app closure without closing a borrowed backend', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })

  class CloseDuringTransaction extends BaseController {
    /** Attempts to write after the app has closed within a transaction. */
    async writeAfterClose(): Promise<void> {
      await this.backend.transaction((transaction) => {
        app.close()
        transaction.insert('items', { id: 'should-not-commit' })
      })
    }
  }
  const cars = new Collection('cars', Resource.extend({ make: z.string() }), { controller: CloseDuringTransaction })

  try {
    app.register(cars)
    await expect(cars.controller.writeAfterClose()).rejects.toThrow('closed')
    expect(await backend.select('items')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})
