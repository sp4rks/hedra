import { expect, test } from 'bun:test'
import { z } from 'zod'

import { BaseController, Config, Hedra, JsonApiListResponse, Resource } from '#hedra.ts'
import { request } from '../fixtures/scope.ts'

const quiet = { HEDRA_SQLITE_PATH: ':memory:', HEDRA_SERVER_SILENT_STARTUP: 'true', HEDRA_SERVER_LOG_LEVEL: 'silent' }

test('named schemas register independently and return their configured controller', async () => {
  const Customer = Resource.extend({ name: z.string() }).meta({ name: 'customers' })

  class Customers extends BaseController {
    /** Supplies an application-specific capability on the returned controller. */
    label(): string {
      return 'customers'
    }
  }
  const first = new Hedra({ config: new Config(quiet) })
  const second = new Hedra({ config: new Config(quiet) })

  try {
    const controller = first.register(Customer, { controller: Customers })

    expect(controller.label()).toBe('customers')
    second.register(Customer)
    const created = await request(first, '/customers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme' }),
    })

    expect(created.status).toBe(201)
    expect(JsonApiListResponse.parse(await (await request(second, '/customers')).json()).data).toEqual([])
  } finally {
    first.close()
    second.close()
  }
})

test('invalid managed declarations fail before controller construction and leave names reusable', async () => {
  const app = new Hedra({ config: new Config(quiet) })
  let constructed = 0

  class Observed extends BaseController {
    /** Records whether declaration validation reached controller construction. */
    constructor(...args: ConstructorParameters<typeof BaseController>) {
      super(...args)
      constructed++
    }
  }
  const Child = Resource.extend({ value: z.string() }).meta({ child: true })
  const Recursive: z.ZodObject = Resource.extend({
    get children() {
      return z.array(Recursive)
    },
  }).meta({ child: true })
  const invalid = [
    Child.meta({ name: 'widgets', child: true }),
    Resource.meta({ name: 'widgets', child: 'true' }),
    Resource.extend({ value: z.array(Child).or(z.string()) }).meta({ name: 'widgets' }),
    Resource.extend({ value: z.tuple([Child]) }).meta({ name: 'widgets' }),
    Resource.extend({ value: z.intersection(Child, z.object({})) }).meta({ name: 'widgets' }),
    Resource.extend({ value: z.array(z.object({ nested: Child })) }).meta({ name: 'widgets' }),
    Resource.extend({ value: Recursive }).meta({ name: 'widgets' }),
    Resource.extend({ 'bad/path': Child }).meta({ name: 'widgets' }),
    Resource.extend({ value: Resource.meta({ child: 1 }) }).meta({ name: 'widgets' }),
  ]

  try {
    for (const schema of invalid) expect(() => app.register(schema, { controller: Observed })).toThrow()
    expect(constructed).toBe(0)
    app.register(Resource.meta({ name: 'widgets', child: false, description: 'Ordinary root' }))
    expect((await request(app, '/widgets')).status).toBe(200)
  } finally {
    app.close()
  }
})
