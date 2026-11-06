import { z } from 'zod'

export const Tenant = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
})

export type Tenant = z.infer<typeof Tenant>
