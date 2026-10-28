import type { z } from 'zod'

import { domainReporting } from '#models/domain.ts'
import { Resource } from '#models/resource.ts'

/** A customer organisation served by this deployment. */
export const Tenant = Resource.extend({
  tenantDomain: domainReporting('Invalid tenant domain')
    .describe('The domain name of the tenant')
    .meta({
      example: 'customername.platformname.com',
      constraints: { unique: true },
    }),
})

export type Tenant = z.infer<typeof Tenant>
