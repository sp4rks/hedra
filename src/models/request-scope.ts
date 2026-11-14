import type { Context } from 'hono'
import { z } from 'zod'

import { OutputValidationError, PreconditionFailedError } from '#errors'
import { isDirectDomain } from '#models/domain.ts'
import { Environment } from '#models/environment.ts'
import { Tenant } from '#models/tenant.ts'

export const RequestScope = z
  .strictObject({ tenant: Tenant, environment: Environment })
  .refine(
    (scope) =>
      scope.environment.tenantDomain === scope.tenant.tenantDomain &&
      isDirectDomain(scope.environment.environmentDomain, scope.tenant.tenantDomain),
  )

export type RequestScope = z.infer<typeof RequestScope>

/** Returns the validated environment scope established by request middleware. */
export function getRequestScope(context: Context): RequestScope | undefined {
  const value: unknown = context.get('hedraRequestScope' as never)

  if (value === undefined) return undefined
  const parsed = RequestScope.safeParse(value)

  if (!parsed.success) throw new OutputValidationError('Invalid request scope', parsed.error.issues)

  return parsed.data
}

/** Refuses application operations without a resolved environment. */
export function requireRequestScope(context: Context): RequestScope {
  const scope = getRequestScope(context)

  if (!scope) throw new PreconditionFailedError('Environment scope is required')

  return scope
}

/** Returns the active tenant resolved for environment management. */
export function requireTenantScope(context: Context): Tenant {
  const parsed = Tenant.safeParse(context.get('hedraTenantScope' as never))

  if (!parsed.success) throw new PreconditionFailedError('Tenant scope is required')

  return parsed.data
}
