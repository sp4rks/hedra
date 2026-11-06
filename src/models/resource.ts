import { z } from 'zod'

export const Resource = z.object({ id: z.uuid() })

export type Resource = z.infer<typeof Resource>

/** Ensures a stored resource model requires a UUID identifier. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new TypeError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new TypeError('Resource model must require a UUID id')
  }
}
