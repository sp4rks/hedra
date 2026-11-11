import type { Context } from 'hono'
import { z } from 'zod'

import type { ResourceReference } from '#models/association.ts'
import type { Collection } from '#models/collection.ts'
import { InputValidationError, parseInput } from '#errors'
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
  collection: FieldName,
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
const containingCollections = new WeakMap<Context, { root: Collection; target: Collection }>()
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
export function setEmbeddedTraversal(
  context: Context,
  scope: EmbeddedTraversal,
  root: Collection,
  target: Collection,
): void {
  traversals.set(context, scope)
  containingCollections.set(context, { root, target })
}

/** Resolves a contained collection only within its generated route. */
export function getContainingCollection(
  context: Context,
  collection: Collection,
): { root: Collection; scope: EmbeddedTraversal } | undefined {
  const containing = containingCollections.get(context)

  if (!collection.parent && !containing) return undefined
  const traversal = getEmbeddedTraversal(context)
  const address = getResourceScope(context)

  if (!containing || containing.target !== collection || !traversal || address?.target.kind !== 'embedded') {
    throw new InputValidationError('Contained collection needs parent scope')
  }
  const steps = traversal.steps.map(({ field, selector }) =>
    field.kind === 'array'
      ? { field: field.name, kind: 'array', ...(selector === undefined ? {} : { id: selector }) }
      : field.kind === 'dictionary'
        ? { field: field.name, kind: 'dictionary', ...(selector === undefined ? {} : { key: selector }) }
        : { field: field.name, kind: 'single' },
  )

  if (
    address.collection !== collection.name ||
    address.target.rootId !== traversal.rootId ||
    !Bun.deepEquals(address.target.steps, steps) ||
    !Bun.deepEquals(address.associations, associationAncestors.get(context) ?? [])
  )
    throw new InputValidationError('Contained scope does not match route')
  let current: Collection | undefined = collection

  for (const step of [...traversal.steps].reverse()) {
    if (!current?.parent || current.name !== step.field.name || current.model !== step.field.model) {
      throw new InputValidationError('Contained scope does not match collection')
    }
    current = current.parent
  }
  if (current !== containing.root || containing.root.parent) {
    throw new InputValidationError('Contained scope does not match root')
  }

  return { root: containing.root, scope: traversal }
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
