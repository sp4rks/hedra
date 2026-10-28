import { z } from 'zod'

import { Domain } from '#models/domain.ts'

/** One Hedra deployment, identified by its root domain. */
export const Deployment = z.object({
  deploymentDomain: Domain.describe("The deployment's root domain, the same value as HEDRA_DEPLOYMENT_DOMAIN").meta({
    example: 'platformname.com',
  }),
})

export type Deployment = z.infer<typeof Deployment>
