import type { z } from 'zod'

import { Environment } from '#models/environment.ts'
import { Tenant } from '#models/tenant.ts'

export const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })

export type TenantInput = z.infer<typeof TenantInput>

export const TenantChanges = Tenant.pick({ name: true }).partial()

export type TenantChanges = z.infer<typeof TenantChanges>

export const EnvironmentInput = Environment.pick({ name: true, environmentDomain: true })

export type EnvironmentInput = z.infer<typeof EnvironmentInput>

export const EnvironmentChanges = Environment.pick({ name: true }).partial()

export type EnvironmentChanges = z.infer<typeof EnvironmentChanges>
