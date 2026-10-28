import type { z } from 'zod'

import { domainReporting } from '#models/domain.ts'
import { Resource } from '#models/resource.ts'

/** A separated part of a tenant, such as dev, test, prod, a brand or a use case. */
export const Environment = Resource.extend({
  environmentDomain: domainReporting('Invalid environment domain')
    .describe('The domain name of the environment')
    .meta({
      example: 'dev.customername.platformname.com',
      constraints: { unique: true },
    }),
  tenantDomain: domainReporting('Invalid tenant domain')
    .describe("The domain name of the environment's tenant")
    .meta({
      example: 'customername.platformname.com',
      constraints: { indexed: true },
    }),
})

export type Environment = z.infer<typeof Environment>
