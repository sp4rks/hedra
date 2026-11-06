import { z } from 'zod'

import { ResourceId } from '#models/resource.ts'

export const ResourceReference = z.strictObject({
  collection: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  id: ResourceId,
})

export type ResourceReference = z.infer<typeof ResourceReference>

export const Association = z.object({ id: ResourceId, source: ResourceReference, target: ResourceReference })

export type Association = z.infer<typeof Association>
