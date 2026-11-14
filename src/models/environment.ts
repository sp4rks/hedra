import type { z } from 'zod'

import { Domain } from '#models/domain.ts'
import { ResourceMetadata } from '#models/metadata.ts'
import { Tenant } from '#models/tenant.ts'

export const Environment = ResourceMetadata.extend({
  name: Tenant.shape.name,
  tenantDomain: Domain.meta({ constraints: { indexed: true } }),
  environmentDomain: Domain.meta({ constraints: { unique: true } }),
}).strict()

export type Environment = z.infer<typeof Environment>

export const EnvironmentInput = Environment.pick({ name: true, environmentDomain: true })

export type EnvironmentInput = z.infer<typeof EnvironmentInput>

export const EnvironmentChanges = Environment.pick({ name: true }).partial()

export type EnvironmentChanges = z.infer<typeof EnvironmentChanges>
