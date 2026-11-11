import { z } from 'zod'

import { Resource } from '#models/resource.ts'

export const Tenant = Resource.extend({
  name: z.string().trim().min(1),
  tenantDomain: z.string().trim().toLowerCase().regex(z.regexes.domain),
}).strict()

export type Tenant = z.infer<typeof Tenant>

export const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantInput = z.infer<typeof TenantInput>

export const TenantChanges = TenantInput.omit({ tenantDomain: true }).partial()

export type TenantChanges = z.infer<typeof TenantChanges>
