import { z } from 'zod'

import { Domain } from '#models/domain.ts'
import { ResourceMetadata } from '#models/metadata.ts'

export const Tenant = ResourceMetadata.extend({
  name: z.string().trim().min(1),
  tenantDomain: Domain.meta({ constraints: { unique: true } }),
}).strict()

export type Tenant = z.infer<typeof Tenant>

export const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantInput = z.infer<typeof TenantInput>

export const TenantChanges = Tenant.pick({ name: true }).partial()

export type TenantChanges = z.infer<typeof TenantChanges>
