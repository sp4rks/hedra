import { z } from 'zod'

import { ConfigurationError } from '#errors'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()

/** Base schema for independently stored resources with server-owned identity and timestamps. */
export const Resource = z.object({ id: ResourceId, createdAt: ResourceTimestamp, updatedAt: ResourceTimestamp })

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
export const Association = z.object({ id: ResourceId, source: ResourceReference, target: ResourceReference })

export type Association = z.infer<typeof Association>

/** Ensures a stored resource model requires a UUID identifier. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new ConfigurationError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new ConfigurationError('Resource model must require a UUID id')
  }
}

/** Identifies output alternatives whose keys cannot be safely inferred. */
function outputKind(schema: z.ZodType, ancestors = new Set<z.ZodType>()): 'scalar' | 'structured' | 'dynamic' {
  if (ancestors.has(schema)) return 'dynamic'
  const path = new Set(ancestors).add(schema)

  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional
  )
    return outputKind(schema.unwrap() as z.ZodType, path)
  if (schema instanceof z.ZodUnion) {
    const kinds = schema.options.map((option) => outputKind(option as z.ZodType, path))

    if (kinds.includes('dynamic')) return 'dynamic'

    return kinds.every((kind) => kind === 'scalar') ? 'scalar' : 'structured'
  }
  if (schema instanceof z.ZodObject) {
    const fields = Object.entries(schema.shape).filter(([key]) => key !== 'password')

    return fields.some(([, field]) => outputKind(field as z.ZodType, path) === 'dynamic') ? 'dynamic' : 'structured'
  }
  if (schema instanceof z.ZodArray)
    return outputKind(schema.element as z.ZodType, path) === 'dynamic' ? 'dynamic' : 'structured'
  if (schema instanceof z.ZodTuple) {
    const items = [...schema.def.items, ...(schema.def.rest ? [schema.def.rest] : [])]

    return items.some((item) => outputKind(item as z.ZodType, path) === 'dynamic') ? 'dynamic' : 'structured'
  }
  if (schema instanceof z.ZodIntersection) {
    const kinds = [outputKind(schema.def.left as z.ZodType, path), outputKind(schema.def.right as z.ZodType, path)]

    if (kinds.includes('dynamic')) return 'dynamic'

    return kinds.every((kind) => kind === 'scalar') ? 'scalar' : 'structured'
  }
  if (
    schema instanceof z.ZodString ||
    schema instanceof z.ZodStringFormat ||
    schema instanceof z.ZodNumber ||
    schema instanceof z.ZodBoolean ||
    schema instanceof z.ZodNull ||
    schema instanceof z.ZodLiteral ||
    schema instanceof z.ZodEnum
  )
    return 'scalar'

  return 'dynamic'
}

/** Derives default public fields without carrying private values or object refinements. */
function publicSchema(schema: z.ZodType, ancestors = new Set<z.ZodType>()): z.ZodType {
  if (schema instanceof z.ZodLazy) return z.lazy(() => publicSchema(schema.unwrap() as z.ZodType))
  if (ancestors.has(schema)) return z.never()
  const path = new Set(ancestors).add(schema)

  if (schema instanceof z.ZodObject) return publicModel(schema, path)
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional
  ) {
    const inner = publicSchema(schema.unwrap() as z.ZodType, path)
    const wrapped = schema.clone({ ...schema.def, innerType: inner } as never)

    return schema instanceof z.ZodDefault || schema instanceof z.ZodCatch ? (wrapped as z.ZodType).pipe(inner) : wrapped
  }
  if (schema instanceof z.ZodArray)
    return schema.clone({ ...schema.def, element: publicSchema(schema.element as z.ZodType, path) } as never)
  if (schema instanceof z.ZodTuple)
    return schema.clone({
      ...schema.def,
      items: schema.def.items.map((item) => publicSchema(item as z.ZodType, path)),
      rest: schema.def.rest ? publicSchema(schema.def.rest as z.ZodType, path) : null,
    } as never)
  if (schema instanceof z.ZodRecord)
    return schema.clone({ ...schema.def, valueType: publicSchema(schema.valueType as z.ZodType, path) } as never)
  if (schema instanceof z.ZodIntersection) {
    if ([schema.def.left, schema.def.right].some((branch) => outputKind(branch as z.ZodType) === 'dynamic'))
      return z.never()

    return schema.clone({
      ...schema.def,
      left: publicSchema(schema.def.left as z.ZodType, path),
      right: publicSchema(schema.def.right as z.ZodType, path),
    } as never)
  }
  if (schema instanceof z.ZodUnion) {
    const kinds = schema.options.map((option) => outputKind(option as z.ZodType))

    if (
      kinds.includes('dynamic') &&
      (kinds.includes('structured') || kinds.filter((kind) => kind === 'dynamic').length > 1)
    )
      return z.never()

    return schema.clone({
      ...schema.def,
      options: schema.options.map((option) => publicSchema(option as z.ZodType, path)),
    } as never)
  }
  if (schema instanceof z.ZodPipe) {
    const input = publicSchema(schema.def.in as z.ZodType, path)
    const output = publicSchema(schema.def.out as z.ZodType, path)
    const visible = schema.def.out instanceof z.ZodTransform ? input : output

    return schema.clone({ ...schema.def, in: input, out: output } as never).pipe(visible)
  }

  return schema
}

/** Builds a default output schema from declared public fields. */
export function publicModel(model: z.ZodObject, ancestors = new Set<z.ZodType>()): z.ZodObject {
  const path = new Set(ancestors).add(model)

  return z.object(
    Object.fromEntries(
      Object.entries(model.shape)
        .filter(([key]) => key !== 'password')
        .map(([key, schema]) => [key, publicSchema(schema as z.ZodType, path)]),
    ),
  )
}
