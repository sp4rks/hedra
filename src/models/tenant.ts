import { z } from 'zod'

import { Resource } from '#models/resource.ts'

export const Tenant = Resource.extend({
  name: z.string().trim().min(1),
})

export type Tenant = z.infer<typeof Tenant>
