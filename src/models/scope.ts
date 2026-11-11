import type { Context } from 'hono'
import { z } from 'zod'

import { parseInput } from '#errors'
import { ResourceId, ResourceReference } from '#models/resource.ts'

export const ResourceScope = z.strictObject({
  collection: ResourceReference.shape.collection,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('collection') }),
    z.strictObject({ kind: z.literal('resource'), id: ResourceId }),
  ]),
})

export type ResourceScope = z.infer<typeof ResourceScope>

/** Stores the generated request's resource address. */
export function setResourceScope(context: Context, scope: ResourceScope): void {
  context.set('hedraResourceScope' as never, scope as never)
}

/** Returns the generated request's resource address. */
export function getResourceScope(context: Context): ResourceScope | undefined {
  const scope: unknown = context.get('hedraResourceScope' as never)

  return scope === undefined ? undefined : parseInput(ResourceScope, scope)
}
