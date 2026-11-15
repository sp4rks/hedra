import type { Context } from 'hono'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
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

const secret = randomBytes(32)
const nonces = new WeakMap<Context, Partial<Record<'request' | 'tenant', string>>>()
const Proof = z.strictObject({ payload: z.string(), signature: z.string().regex(/^[a-f0-9]{64}$/) })
const keys = { request: 'hedraRequestScope', tenant: 'hedraTenantScope' } as const

/** Authenticates one purpose, Context nonce and immutable serialized scope together. */
function mac(purpose: keyof typeof keys, nonce: string, payload: string): Buffer {
  return createHmac('sha256', secret)
    .update(JSON.stringify([purpose, nonce, payload]))
    .digest()
}

/** Issues process-local provenance; trusted middleware has authority, not user authentication or an app-code sandbox. */
function issue(context: Context, purpose: keyof typeof keys, value: unknown): void {
  const payload = JSON.stringify(value)
  const nonce = randomBytes(32).toString('hex')

  nonces.set(context, { ...nonces.get(context), [purpose]: nonce })
  context.set(keys[purpose] as never, { payload, signature: mac(purpose, nonce, payload).toString('hex') } as never)
}

/** Verifies one detached serialized payload before parsing that same authenticated snapshot. */
function verified<T>(context: Context, purpose: keyof typeof keys, schema: z.ZodType<T>): T | undefined {
  const value: unknown = context.get(keys[purpose] as never)
  const nonce = nonces.get(context)?.[purpose]

  if (value === undefined && nonce === undefined) return undefined
  const proof = Proof.safeParse(value)

  if (!nonce || !proof.success) throw new OutputValidationError('Invalid scope proof')
  const { payload, signature } = proof.data

  if (!timingSafeEqual(Buffer.from(signature, 'hex'), mac(purpose, nonce, payload)))
    throw new OutputValidationError('Invalid scope proof')
  let snapshot: unknown

  try {
    snapshot = JSON.parse(payload)
  } catch {
    throw new OutputValidationError('Invalid scope payload')
  }
  const parsed = schema.safeParse(snapshot)

  if (!parsed.success) throw new OutputValidationError('Invalid request scope', parsed.error.issues)

  return parsed.data
}

/** Signs a detached, validated full scope for trusted request middleware only. */
export function issueRequestScope(context: Context, scope: RequestScope): void {
  issue(context, 'request', RequestScope.parse(scope))
}

/** Returns a detached scope only after verifying its middleware provenance and Context binding. */
export function getRequestScope(context: Context): RequestScope | undefined {
  return verified(context, 'request', RequestScope)
}

/** Refuses application operations without a resolved environment. */
export function requireRequestScope(context: Context): RequestScope {
  const scope = getRequestScope(context)

  if (!scope) throw new PreconditionFailedError('Environment scope is required')

  return scope
}

/** Signs a detached, validated tenant scope for trusted catalogue middleware only. */
export function issueTenantScope(context: Context, tenant: Tenant): void {
  issue(context, 'tenant', Tenant.parse(tenant))
}

/** Returns the authenticated tenant resolved for environment management. */
export function requireTenantScope(context: Context): Tenant {
  const tenant = verified(context, 'tenant', Tenant)

  if (!tenant) throw new PreconditionFailedError('Tenant scope is required')

  return tenant
}
