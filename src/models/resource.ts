import { z } from 'zod'

import { ConfigurationError } from '#errors'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()
const resourceKinds = z.registry<{ kind: 'resource' | 'embedded' }>()
const embeddedId = z.uuid()

resourceKinds.add(ResourceId, { kind: 'resource' })
resourceKinds.add(embeddedId, { kind: 'embedded' })

export const Resource = z.object({ id: ResourceId, createdAt: ResourceTimestamp, updatedAt: ResourceTimestamp })
export const EmbeddedResource = Resource.extend({ id: embeddedId })

export type Resource = z.infer<typeof Resource>
export type EmbeddedResource = z.infer<typeof EmbeddedResource>

/** Identifies a resource definition without adding a stored discriminator. */
export function resourceKind(model: z.ZodObject): 'resource' | 'embedded' | undefined {
  const id = model.shape.id

  return id ? resourceKinds.get(id)?.kind : undefined
}

/** Ensures a stored resource model requires a UUID identifier. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new ConfigurationError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new ConfigurationError('Resource model must require a UUID id')
  }
  if (resourceKind(model) === 'embedded') throw new ConfigurationError('Embedded resources cannot own collections')
}
