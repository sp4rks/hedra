import type { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import { Environment } from '#models/environment.ts'
import { resourceHandlers } from '#web/resources.ts'

export const EnvironmentInput = Environment.pick({ name: true, environmentDomain: true })

export type EnvironmentInput = z.infer<typeof EnvironmentInput>

export const EnvironmentChanges = Environment.pick({ name: true }).partial()

export type EnvironmentChanges = z.infer<typeof EnvironmentChanges>

/** Builds the environment HTTP handlers with their public request validators. */
export function environmentHandlers(controller: ControllerInterface) {
  return resourceHandlers(
    Environment.meta({ name: 'environments' }),
    controller,
    { create: EnvironmentInput, update: EnvironmentChanges, output: Environment },
    'tenantDomain',
    'environmentDomain',
  )
}
