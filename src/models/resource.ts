import { z } from 'zod'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()
export const Resource = z.object({ id: ResourceId, createdAt: ResourceTimestamp, updatedAt: ResourceTimestamp })

export type Resource = z.infer<typeof Resource>

/** Ensures a stored resource model requires a UUID identifier. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new TypeError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new TypeError('Resource model must require a UUID id')
  }
}
