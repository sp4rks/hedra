import type { z } from 'zod'

import { Domain } from '#models/domain.ts'
import { Resource } from '#models/resource.ts'
import { Tenant } from '#models/tenant.ts'

export const Environment = Resource.pick({ id: true, createdAt: true, updatedAt: true })
  .extend({
    name: Tenant.shape.name,
    tenantDomain: Domain.meta({ indexed: true }),
    environmentDomain: Domain.meta({ unique: true }),
  })
  .strict()

export type Environment = z.infer<typeof Environment>
