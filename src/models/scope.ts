import type { Context } from 'hono'
import { z } from 'zod'

import type { ResourceReference } from '#models/association.ts'
import { parseInput } from '#errors'
import { ResourceReference as ReferenceSchema } from '#models/association.ts'
import { EmbeddedField } from '#models/embedded.ts'
import { ResourceId } from '#models/resource.ts'

const FieldName = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
const DictionaryKey = z
  .string()
  .min(1)
  .refine((key) => !['.', '..', '__proto__'].includes(key))

export const EmbeddedStep = z.discriminatedUnion('kind', [
  z.strictObject({ field: FieldName, kind: z.literal('array'), id: ResourceId.optional() }),
  z.strictObject({ field: FieldName, kind: z.literal('dictionary'), key: DictionaryKey.optional() }),
  z.strictObject({ field: FieldName, kind: z.literal('single') }),
])
export const EmbeddedScope = z.strictObject({
  rootId: ResourceId,
  steps: z
    .array(EmbeddedStep)
    .min(1)
    .refine((steps) =>
      steps
        .slice(0, -1)
        .every(
          (step) => step.kind === 'single' || (step.kind === 'array' ? step.id !== undefined : step.key !== undefined),
        ),
    ),
})
export const AssociationScope = z.array(ReferenceSchema)
export const ResourceScope = z.strictObject({
  collection: ReferenceSchema.shape.collection,
  target: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('collection') }),
    z.strictObject({ kind: z.literal('resource'), id: ResourceId }),
    EmbeddedScope.extend({ kind: z.literal('embedded') }),
  ]),
  associations: AssociationScope,
})

export type EmbeddedStep = z.infer<typeof EmbeddedStep>
export type EmbeddedScope = z.infer<typeof EmbeddedScope>
export type AssociationScope = z.infer<typeof AssociationScope>
export type ResourceScope = z.infer<typeof ResourceScope>

const TraversalStep = z.object({ field: EmbeddedField, selector: z.string().optional() })
const EmbeddedTraversal = z.object({ rootId: ResourceId, steps: z.array(TraversalStep) })

export type TraversalStep = z.infer<typeof TraversalStep>
export type EmbeddedTraversal = z.infer<typeof EmbeddedTraversal>

const traversals = new WeakMap<Context, EmbeddedTraversal>()
const associationAncestors = new WeakMap<Context, ResourceReference[]>()

/** Stores the generated request's resource address. */
export function setResourceScope(context: Context, scope: ResourceScope): void {
  context.set('hedraResourceScope' as never, scope as never)
}

/** Returns the generated request's resource address. */
export function getResourceScope(context: Context): ResourceScope | undefined {
  const scope: unknown = context.get('hedraResourceScope' as never)

  return scope === undefined ? undefined : parseInput(ResourceScope, scope)
}

/** Stores route-discovered traversal metadata for the default controller. */
export function setEmbeddedTraversal(context: Context, scope: EmbeddedTraversal): void {
  traversals.set(context, scope)
}

/** Returns internal route-discovered traversal metadata. */
export function getEmbeddedTraversal(context: Context): EmbeddedTraversal | undefined {
  const scope = traversals.get(context)

  return scope === undefined ? undefined : parseInput(EmbeddedTraversal, scope)
}

/** Returns embedded ancestry installed by a generated route. */
export function getEmbeddedScope(context: Context): EmbeddedScope | undefined {
  const scope = getResourceScope(context)

  if (scope?.target.kind !== 'embedded') return undefined

  return { rootId: scope.target.rootId, steps: scope.target.steps }
}

/** Stores resource ancestors for internal association operations. */
export function setAssociationScope(context: Context, ancestors: ResourceReference[]): void {
  associationAncestors.set(context, ancestors)
}

/** Returns ancestors installed by a generated association route. */
export function getAssociationScope(context: Context): ResourceReference[] | undefined {
  const scope = getResourceScope(context)

  if (scope) return scope.associations.length ? scope.associations : undefined
  const ancestors = associationAncestors.get(context)

  return ancestors === undefined ? undefined : parseInput(AssociationScope, ancestors)
}
