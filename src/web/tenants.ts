import type { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import { Tenant } from '#models/tenant.ts'
import { resourceHandlers } from '#web/resources.ts'

export const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantInput = z.infer<typeof TenantInput>

export const TenantChanges = Tenant.pick({ name: true }).partial()

export type TenantChanges = z.infer<typeof TenantChanges>

/** Builds the tenant HTTP handlers with their public request validators. */
export function tenantHandlers(controller: ControllerInterface) {
  return resourceHandlers(
    Tenant.meta({ name: 'tenants' }),
    controller,
    { create: TenantInput, update: TenantChanges, output: Tenant },
    null,
    'tenantDomain',
  )
}
