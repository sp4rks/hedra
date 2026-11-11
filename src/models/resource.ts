import { z } from 'zod'

import { ConfigurationError } from '#errors'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()
export const Resource = z.object({ id: ResourceId, createdAt: ResourceTimestamp, updatedAt: ResourceTimestamp })

export type Resource = z.infer<typeof Resource>

/** Ensures a stored resource model requires a UUID identifier. */
export function assertResourceModel(model: z.ZodObject): void {
  if (!(model instanceof z.ZodObject)) throw new ConfigurationError('Resource model must be a Zod object')

  if (!(model.shape.id instanceof z.ZodUUID)) {
    throw new ConfigurationError('Resource model must require a UUID id')
  }
}

/** Derives default public fields without carrying private values or object refinements. */
function publicSchema(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) return publicModel(schema)
  if (
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodDefault ||
    schema instanceof z.ZodCatch ||
    schema instanceof z.ZodPrefault ||
    schema instanceof z.ZodReadonly ||
    schema instanceof z.ZodNonOptional
  ) {
    const inner = publicSchema(schema.unwrap() as z.ZodType)
    const wrapped = schema.clone({ ...schema.def, innerType: inner } as never)

    return schema instanceof z.ZodDefault || schema instanceof z.ZodCatch ? (wrapped as z.ZodType).pipe(inner) : wrapped
  }
  if (schema instanceof z.ZodArray)
    return schema.clone({ ...schema.def, element: publicSchema(schema.element as z.ZodType) } as never)
  if (schema instanceof z.ZodRecord)
    return schema.clone({ ...schema.def, valueType: publicSchema(schema.valueType as z.ZodType) } as never)
  if (schema instanceof z.ZodUnion)
    return schema.clone({
      ...schema.def,
      options: schema.options.map((option) => publicSchema(option as z.ZodType)),
    } as never)
  if (schema instanceof z.ZodLazy) return z.lazy(() => publicSchema(schema.unwrap() as z.ZodType))
  if (schema instanceof z.ZodPipe) {
    const input = publicSchema(schema.def.in as z.ZodType)

    return schema.clone({ ...schema.def, in: input } as never).pipe(input)
  }

  return schema
}

/** Builds a default output schema from declared public fields. */
export function publicModel(model: z.ZodObject): z.ZodObject {
  return z.object(
    Object.fromEntries(
      Object.entries(model.shape)
        .filter(([key]) => key !== 'password')
        .map(([key, schema]) => [key, publicSchema(schema as z.ZodType)]),
    ),
  )
}
