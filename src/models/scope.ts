import type { Context } from 'hono'
import { z } from 'zod'

import type { ResourceReference } from '#models/association.ts'
import { ResourceReference as ReferenceSchema } from '#models/association.ts'
import { EmbeddedField } from '#models/embedded.ts'
import { ResourceId } from '#models/resource.ts'

export const EmbeddedStep = z.object({ field: EmbeddedField, selector: z.string().optional() })
export const EmbeddedScope = z.object({ rootId: ResourceId, steps: z.array(EmbeddedStep) })
export const AssociationScope = z.array(ReferenceSchema)

export type EmbeddedStep = z.infer<typeof EmbeddedStep>
export type EmbeddedScope = z.infer<typeof EmbeddedScope>
export type AssociationScope = z.infer<typeof AssociationScope>

/** Stores validated route ancestry for the controller receiving this context. */
export function setEmbeddedScope(context: Context, scope: EmbeddedScope): void {
  context.set('hedraScope' as never, scope as never)
}

/** Returns ancestry installed by a generated embedded route. */
export function getEmbeddedScope(context: Context): EmbeddedScope | undefined {
  const scope: unknown = context.get('hedraScope' as never)

  return scope === undefined ? undefined : EmbeddedScope.parse(scope)
}

/** Stores resource ancestors for a generated association route. */
export function setAssociationScope(context: Context, ancestors: ResourceReference[]): void {
  context.set('hedraAssociations' as never, ancestors as never)
}

/** Returns ancestors installed by a generated association route. */
export function getAssociationScope(context: Context): ResourceReference[] | undefined {
  const scope: unknown = context.get('hedraAssociations' as never)

  return scope === undefined ? undefined : AssociationScope.parse(scope)
}
