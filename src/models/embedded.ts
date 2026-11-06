import { z } from 'zod'

import { ResourceId, resourceKind } from '#models/resource.ts'

export const EmbeddedField = z.object({
  name: z.string(),
  kind: z.enum(['array', 'dictionary', 'single']),
  model: z.instanceof(z.ZodObject),
  schema: z.custom<z.ZodType>((value) => value instanceof z.ZodType),
  key: z.custom<z.ZodType>((value) => value instanceof z.ZodType).optional(),
})

export type EmbeddedField = z.infer<typeof EmbeddedField>

/** Removes wrappers that do not change the underlying container kind. */
export function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema

  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
    current = current.unwrap() as z.ZodType
  }

  return current
}

/** Detects resource definitions hidden inside unsupported schema wrappers. */
function containsResource(schema: z.ZodType, seen = new Set<z.ZodType>()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  if (schema instanceof z.ZodObject && resourceKind(schema)) return true
  if (schema instanceof z.ZodLazy) return containsResource(schema.unwrap() as z.ZodType, seen)

  const contains = (value: unknown): boolean => {
    if (value instanceof z.ZodType) return containsResource(value, seen)
    if (Array.isArray(value)) return value.some(contains)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.values(value).some(contains)
    }

    return false
  }

  return Object.values(schema.def).some(contains)
}

/** Finds the direct embedded fields declared by one resource model. */
export function embeddedFields(model: z.ZodObject): EmbeddedField[] {
  return Object.entries(model.shape).flatMap(([name, schema]) => {
    const container = unwrap(schema)
    const kind = container instanceof z.ZodArray ? 'array' : container instanceof z.ZodRecord ? 'dictionary' : 'single'
    const element =
      kind === 'array'
        ? (container as z.ZodArray).element
        : kind === 'dictionary'
          ? (container as z.ZodRecord).valueType
          : container
    const item = unwrap(element as z.ZodType)

    if (!(item instanceof z.ZodObject)) {
      if (containsResource(schema)) throw new TypeError(`Unsupported embedded resource placement: ${name}`)

      return []
    }
    const resource = resourceKind(item)

    if (resource === 'resource') throw new TypeError('Independent resources cannot be embedded as owned values')
    if (resource !== 'embedded') {
      if (containsResource(schema)) throw new TypeError(`Unsupported embedded resource placement: ${name}`)

      return []
    }

    return [
      {
        name,
        kind,
        model: item,
        schema,
        ...(kind === 'dictionary' ? { key: (container as z.ZodRecord).keyType as z.ZodType } : {}),
      },
    ]
  })
}

/** Substitutes an embedded item schema while retaining container constraints. */
export function replaceItem(schema: z.ZodType, item: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return schema.clone({ ...schema.def, innerType: replaceItem(schema.unwrap() as z.ZodType, item) } as never)
  }
  if (schema instanceof z.ZodArray) return schema.clone({ ...schema.def, element: item } as never)
  if (schema instanceof z.ZodRecord) return schema.clone({ ...schema.def, valueType: item } as never)

  return item
}

/** Derives the public creation or partial-update validator from the stored model. */
export function inputModel(model: z.ZodObject, partial: boolean, selector = false): z.ZodObject {
  const mask = Object.fromEntries(
    ['id', 'createdAt', 'updatedAt'].filter((key) => Object.hasOwn(model.shape, key)).map((key) => [key, true]),
  )
  const input = model.clone({ ...model.def, checks: [] } as never)
  let result = input.omit(mask as never)
  const shape = Object.fromEntries(
    embeddedFields(model).map((field) => {
      let item = inputModel(field.model, false, partial)

      if (!partial)
        item = item.extend({
          id: z.unknown().optional(),
          createdAt: z.unknown().optional(),
          updatedAt: z.unknown().optional(),
        })

      return [field.name, replaceItem(field.schema, item)]
    }),
  )

  if (Object.keys(shape).length) result = result.extend(shape)
  if (selector)
    result = result.extend({
      id: ResourceId.optional(),
      createdAt: z.unknown().optional(),
      updatedAt: z.unknown().optional(),
    })

  return partial ? result.partial() : result
}

/** Builds a recursive default public projection for embedded definitions. */
export function publicModel(model: z.ZodObject): z.ZodObject {
  const children = new Map(embeddedFields(model).map((field) => [field.name, field]))
  const shape = Object.fromEntries(
    Object.entries(model.shape)
      .filter(([key]) => key !== 'password')
      .map(([key, schema]) => {
        const child = children.get(key)

        return [key, child ? replaceItem(schema, publicModel(child.model)) : schema]
      }),
  )

  return z.object(shape)
}
