import type { Context, MiddlewareHandler } from 'hono'

import type { Config } from '#config'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import { OutputValidationError, PreconditionFailedError, RecordNotFoundError } from '#errors'
import { Domain, isDirectDomain } from '#models/domain.ts'
import { Environment } from '#models/environment.ts'
import { issueRequestScope, issueTenantScope, RequestScope } from '#models/request-scope.ts'
import { Tenant } from '#models/tenant.ts'

/** Parses the actual Host header without trusting forwarded headers or malformed ports. */
export function requestHostname(context: Context): string {
  const match = context.req.header('host')?.match(/^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i)

  if (!match?.[1] || (match[2] !== undefined && Number(match[2]) > 65535))
    throw new PreconditionFailedError('A valid Host header is required')
  const parsed = Domain.safeParse(match[1])

  if (!parsed.success) throw new PreconditionFailedError('A valid Host header is required')

  return parsed.data
}

/** Checks the configured tenant-host level without accessing configuration storage. */
function tenantHost(config: Config, domain: string): void {
  if (
    !isDirectDomain(domain, config.deploymentDomain) ||
    [config.deploymentApiDomain.toLowerCase(), config.deploymentDocsDomain.toLowerCase()].includes(domain)
  )
    throw new PreconditionFailedError('A tenant host is required')
}

/** Loads exactly one valid active tenant for its canonical domain. */
async function findTenant(store: ConfigDatastore, domain: string): Promise<Tenant> {
  const value = await store.tenants.get(domain)

  if (value === null) throw new RecordNotFoundError()
  const parsed = Tenant.safeParse(value)

  if (!parsed.success || parsed.data.tenantDomain !== domain)
    throw new OutputValidationError('Invalid tenant resolution')

  return parsed.data
}

/** Resolves the active tenant before any environment request input is processed. */
export function tenantMiddleware(config: Config, datastore: () => ConfigDatastore): MiddlewareHandler {
  return async (context, next) => {
    const domain = requestHostname(context)

    tenantHost(config, domain)
    const tenant = await findTenant(datastore(), domain)

    issueTenantScope(context, tenant)
    await next()
  }
}

/** Resolves provisioned tenant/environment records once for CRUD and custom handlers. */
export function environmentMiddleware(config: Config, datastore: () => ConfigDatastore): MiddlewareHandler {
  return async (context, next) => {
    const domain = requestHostname(context)
    const parent = domain.slice(domain.indexOf('.') + 1)

    tenantHost(config, parent)
    if (!isDirectDomain(domain, parent)) throw new PreconditionFailedError('An environment host is required')
    const store = datastore()
    const tenant = await findTenant(store, parent)
    const value = await store.environments.get(parent, domain)

    if (value === null) throw new RecordNotFoundError()
    const environment = Environment.safeParse(value)
    const scope = RequestScope.safeParse({ tenant, environment: environment.success ? environment.data : undefined })

    if (!environment.success || environment.data.environmentDomain !== domain || !scope.success)
      throw new OutputValidationError('Invalid environment resolution')

    issueRequestScope(context, scope.data)
    await next()
  }
}
