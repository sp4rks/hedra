import { z } from 'zod'

import { Domain } from '#models/domain.ts'
import { Resource } from '#models/resource.ts'

export const Tenant = Resource.pick({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: z.string().trim().min(1),
    tenantDomain: Domain.meta({ unique: true }),
  })
  .strict()

export type Tenant = z.infer<typeof Tenant>

export const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantInput = z.infer<typeof TenantInput>

export const TenantChanges = Tenant.pick({ name: true }).partial()

export type TenantChanges = z.infer<typeof TenantChanges>
