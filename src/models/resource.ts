import { z } from 'zod'

import { ConfigurationError } from '#errors'
import { Domain } from '#models/domain.ts'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()

/** Base schema for application resources with server-owned identity, timestamps and environment. */
export const Resource = z.object({
  id: ResourceId,
  createdAt: ResourceTimestamp,
  updatedAt: ResourceTimestamp,
  environmentDomain: Domain.meta({ indexed: true }),
})

export type Resource = z.infer<typeof Resource>

/** Addresses a resource by collection and UUID without containing its data or guaranteeing it exists. */
export const ResourceReference = z.strictObject({
  collection: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  id: ResourceId,
})

export type ResourceReference = z.infer<typeof ResourceReference>

/**
 * An explicit link between independent resources, with its own ID and resource addresses as endpoints.
 * Links are stored separately and block deletion of either endpoint until removed.
 */
export const Association = z.object({
  id: ResourceId,
  environmentDomain: Domain,
  source: ResourceReference,
  target: ResourceReference,
})

export type Association = z.infer<typeof Association>

/** Requires complete server-managed metadata on stored application models. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new ConfigurationError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new ConfigurationError('Resource model must require a UUID id')
  }

  for (const key of ['createdAt', 'updatedAt', 'environmentDomain'] as const) {
    const original = model.shape[key] as z.ZodType | undefined
    let field = original

    while (field instanceof z.ZodPipe) field = field.in as z.ZodType
    const valid =
      key === 'environmentDomain'
        ? field instanceof z.ZodString
        : field instanceof z.ZodISODateTime || (field instanceof z.ZodString && field.format === 'datetime')

    if (!valid || original?.isOptional() || original?.isNullable())
      throw new ConfigurationError(`Resource model must require ${key}`)
  }
}

/** Reads the safe storage and route name declared by a root schema. */
export function resourceName(model: z.ZodObject): string {
  if (!(model instanceof z.ZodObject)) throw new ConfigurationError('Expected a resource schema')
  const metadata = z
    .object({ name: ResourceReference.shape.collection, child: z.boolean().optional() })
    .safeParse(model.meta())

  if (!metadata.success) throw new ConfigurationError('Invalid resource metadata', metadata.error.issues)
  if (metadata.data.child) throw new ConfigurationError('Child resources cannot be registered as roots')

  return metadata.data.name
}
