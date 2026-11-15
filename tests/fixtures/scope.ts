import type { Context } from 'hono'

import type { Backend, DatabaseRecord } from '#hedra.ts'
import { Config, Hedra } from '#hedra.ts'

const preparations = new WeakMap<Hedra, Promise<string>>()
export const fixtureDomain = 'dev.fixture.hedra.local'

/** Provisions real catalogue records once for an application test fixture. */
export function provision(app: Hedra): Promise<string> {
  const existing = preparations.get(app)

  if (existing) return existing
  const ready = (async () => {
    const tenants = await app.configDatastore.tenants.list()
    const tenant =
      tenants.find((value) => value.tenantDomain.endsWith(`.${app.config.deploymentDomain}`)) ??
      (await app.configDatastore.tenants.create({
        name: 'Fixture',
        tenantDomain: `fixture.${app.config.deploymentDomain}`,
      }))
    const domain = `dev.${tenant.tenantDomain}`
    const environments = await app.configDatastore.environments.list(tenant.tenantDomain, { environmentDomain: domain })

    if (!environments.length)
      await app.configDatastore.environments.create(tenant.tenantDomain, { name: 'Fixture', environmentDomain: domain })

    return domain
  })()

  preparations.set(app, ready)

  return ready
}

/** Sends an actual HTTP request with the fixture's provisioned environment Host. */
export async function request(app: Hedra, input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const domain = await provision(app)
  const headers = new Headers(input instanceof Request ? input.headers : undefined)

  new Headers(init.headers).forEach((value, key) => {
    headers.set(key, value)
  })
  if (!headers.has('host')) headers.set('host', domain)

  return await app.request(input, { ...init, headers })
}

/** Resolves a real scoped request context for direct public controller tests. */
export async function scopedContext(url = 'http://localhost/items'): Promise<Context> {
  const app = new Hedra({
    config: new Config({
      HEDRA_SQLITE_PATH: ':memory:',
      HEDRA_SERVER_SILENT_STARTUP: 'true',
      HEDRA_SERVER_LOG_LEVEL: 'silent',
    }),
  })
  let context: Context | undefined

  app.scoped.get(new URL(url).pathname, (value) => {
    context = value

    return value.text('ok')
  })
  try {
    await request(app, url)
    if (!context) throw new Error('Fixture request did not resolve scope')

    return context
  } finally {
    app.close()
  }
}

/** Seeds an application row with explicit fixture ownership through its backend seam. */
export async function insert(backend: Backend, table: string, record: DatabaseRecord): Promise<void> {
  await backend.insert(table, { environmentDomain: fixtureDomain, ...record })
}
