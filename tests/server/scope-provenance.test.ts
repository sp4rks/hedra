import { expect, test } from 'bun:test'
import { Context, Hono } from 'hono'
import { z } from 'zod'

import { OutputValidationError } from '#errors'
import {
  BaseController,
  Config,
  ConfigStore,
  Environment,
  EnvironmentController,
  getRequestScope,
  Hedra,
  Resource,
  SqliteBackend,
} from '#hedra.ts'
import { request, scopedContext } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('application controllers accept issued scopes after fixture closure and reject unsigned valid scope injection', async () => {
  const issued = await scopedContext('http://localhost/widgets')
  const scope = getRequestScope(issued)
  const forged = new Context(new Request('http://localhost/widgets'))
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Widget = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })

  try {
    expect(scope).toBeDefined()
    expect(getRequestScope(forged)).toBeUndefined()
    await expect(controller.create(forged, Widget, { name: 'Missing scope' })).rejects.toMatchObject({ status: 412 })
    forged.set('hedraRequestScope' as never, scope as never)
    expect(() => getRequestScope(forged)).toThrow(OutputValidationError)
    await expect(controller.create(forged, Widget, { name: 'Forged scope' })).rejects.toBeInstanceOf(
      OutputValidationError,
    )
    expect(await backend.select('widgets')).toEqual([])
    const created = await controller.create(issued, Widget, { name: 'Issued scope' })

    expect(created.data.environmentDomain).toBe(scope?.environment.environmentDomain)
    expect((await controller.list(issued, Widget, issued.req.url)).data).toHaveLength(1)
  } finally {
    backend.close()
  }
})

test('environment catalogue controllers require signed tenant-only provenance from real request middleware', async () => {
  const store = new ConfigStore({ config: new Config(quiet) })
  const app = new Hedra({ config: new Config(quiet), configDatastore: store })
  const host = new Hono()
  let captured: Context | undefined
  const controller = new EnvironmentController(() => store)
  const model = Environment.meta({ name: 'environments' })
  const tenant = await store.tenants.create({ name: 'Tenant', tenantDomain: 'tenant.hedra.local' })

  host.use('*', async (context, next) => {
    captured = context
    await next()
  })
  host.route('/', app)
  try {
    expect((await host.request('/environments', { headers: { host: tenant.tenantDomain } })).status).toBe(200)
    if (!captured) throw new Error('Tenant context was not captured')
    expect(getRequestScope(captured)).toBeUndefined()
    const created = await controller.create(captured, model, {
      name: 'Dev',
      environmentDomain: 'dev.tenant.hedra.local',
    })

    expect(created.data.tenantDomain).toBe(tenant.tenantDomain)
    const issued = captured
    const proof = issued.get('hedraTenantScope' as never) as { payload: string; signature: string }
    const full = await scopedContext('http://localhost/widgets')

    for (const value of [
      tenant,
      { ...proof, payload: JSON.stringify({ ...tenant, tenantDomain: 'another.hedra.local' }) },
      { ...proof, signature: '0'.repeat(64) },
      full.get('hedraRequestScope' as never),
      null,
      undefined,
    ]) {
      issued.set('hedraTenantScope' as never, value as never)
      await expect(
        controller.create(issued, model, { name: 'Forged', environmentDomain: 'forged.tenant.hedra.local' }),
      ).rejects.toBeInstanceOf(OutputValidationError)
    }
    expect((await host.request('/environments', { headers: { host: tenant.tenantDomain } })).status).toBe(200)
    if (!captured || captured === issued) throw new Error('Replay context was not captured')
    captured.set('hedraTenantScope' as never, proof as never)
    await expect(controller.list(captured, model, captured.req.url)).rejects.toBeInstanceOf(OutputValidationError)
    issued.set('hedraTenantScope' as never, proof as never)
    issued.set('hedraRequestScope' as never, proof as never)
    expect(() => getRequestScope(issued)).toThrow(OutputValidationError)
    expect(await store.environments.list(tenant.tenantDomain)).toHaveLength(1)
    const missing = new Context(new Request('http://localhost/environments'))

    await expect(controller.list(missing, model, missing.req.url)).rejects.toMatchObject({ status: 412 })
  } finally {
    app.close()
    store.close()
  }
})

test('scope payload edits, signature edits, deletion and replay fail before application storage', async () => {
  const issued = await scopedContext('http://localhost/widgets')
  const replay = await scopedContext('http://localhost/widgets')
  const scope = getRequestScope(issued)
  const proof = issued.get('hedraRequestScope' as never) as { payload: string; signature: string }
  const backend = new SqliteBackend(':memory:')
  const controller = new BaseController(backend)
  const Widget = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })

  if (!scope) throw new Error('Missing issued scope')
  const original = structuredClone(scope)

  scope.environment.environmentDomain = `prod.${scope.tenant.tenantDomain}`
  scope.tenant.name = 'Mutated caller copy'
  expect(getRequestScope(issued)).toEqual(original)
  try {
    for (const value of [
      {
        ...proof,
        payload: JSON.stringify({
          ...original,
          environment: { ...original.environment, environmentDomain: `prod.${original.tenant.tenantDomain}` },
        }),
      },
      {
        ...proof,
        payload: JSON.stringify({ ...original, tenant: { ...original.tenant, tenantDomain: 'another.hedra.local' } }),
      },
      { ...proof, signature: `${proof.signature[0] === '0' ? '1' : '0'}${proof.signature.slice(1)}` },
      { ...proof, payload: 'not JSON' },
      { payload: proof.payload, signature: 'invalid signature' },
      {},
      null,
      undefined,
    ]) {
      issued.set('hedraRequestScope' as never, value as never)
      expect(() => getRequestScope(issued)).toThrow(OutputValidationError)
      await expect(controller.create(issued, Widget, { name: 'Tampered' })).rejects.toBeInstanceOf(
        OutputValidationError,
      )
    }
    expect(await backend.select('widgets')).toEqual([])
    replay.set('hedraRequestScope' as never, proof as never)
    expect(() => getRequestScope(replay)).toThrow(OutputValidationError)
    await expect(controller.list(replay, Widget, replay.req.url)).rejects.toBeInstanceOf(OutputValidationError)
    issued.set('hedraRequestScope' as never, proof as never)
    expect(getRequestScope(issued)).toEqual(original)
    const created = await controller.create(issued, Widget, { name: 'Original' })

    expect(created.data.environmentDomain).toBe(original.environment.environmentDomain)
  } finally {
    backend.close()
  }
})

test('scoped HTTP handlers redact invalid proof failures from the shared controller path', async () => {
  const backend = new SqliteBackend(':memory:')
  const app = new Hedra({ config: new Config(quiet), backend })
  const Widget = Resource.extend({ name: z.string() }).meta({ name: 'widgets' })
  const controller = app.register(Widget)

  app.scoped.get('/invalid-proof', async (context) => {
    context.set('hedraRequestScope' as never, undefined as never)

    return context.json(await controller.list(context, Widget, context.req.url))
  })
  try {
    const response = await request(app, '/invalid-proof')

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ errors: [{ status: 500, title: 'internal server error' }] })
    expect(await backend.select('widgets')).toEqual([])
  } finally {
    app.close()
    backend.close()
  }
})
