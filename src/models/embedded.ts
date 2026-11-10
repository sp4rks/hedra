import { z } from 'zod'

import { ConfigurationError } from '#errors'
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
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema

  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault) {
    current = current.unwrap() as z.ZodType
  }

  return current
}

/** Identifies an embedded container and unwraps its item definition. */
function container(schema: z.ZodType): { kind: EmbeddedField['kind']; item: z.ZodType; key?: z.ZodType } {
  const current = unwrap(schema)

  if (current instanceof z.ZodArray) return { kind: 'array', item: unwrap(current.element as z.ZodType) }
  if (current instanceof z.ZodRecord)
    return { kind: 'dictionary', item: unwrap(current.valueType as z.ZodType), key: current.keyType as z.ZodType }

  return { kind: 'single', item: current }
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
    const { kind, item, key } = container(schema)

    if (!(item instanceof z.ZodObject)) {
      if (containsResource(schema)) throw new ConfigurationError(`Unsupported embedded resource placement: ${name}`)

      return []
    }
    const resource = resourceKind(item)

    if (resource === 'resource')
      throw new ConfigurationError('Independent resources cannot be embedded as owned values')
    if (resource !== 'embedded') {
      if (containsResource(schema)) throw new ConfigurationError(`Unsupported embedded resource placement: ${name}`)

      return []
    }

    return [
      {
        name,
        kind,
        model: item,
        schema,
        ...(kind === 'dictionary' ? { key } : {}),
      },
    ]
  })
}

/** Substitutes an embedded item schema while retaining container constraints. */
function replaceItem(schema: z.ZodType, item: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return schema.clone({ ...schema.def, innerType: replaceItem(schema.unwrap() as z.ZodType, item) } as never)
  }
  if (schema instanceof z.ZodArray) return schema.clone({ ...schema.def, element: item } as never)
  if (schema instanceof z.ZodRecord) return schema.clone({ ...schema.def, valueType: item } as never)

  return item
}

/** Finds an exposed embedded item model, checking its container and UUID. */
export function publicItem(field: EmbeddedField, output: z.ZodObject): z.ZodObject | undefined {
  const schema = output.shape[field.name]

  if (!schema) return undefined
  const { kind, item } = container(schema)

  if (field.kind !== 'single' && field.kind !== kind)
    throw new ConfigurationError(`Embedded output shape is incompatible: ${field.name}`)
  if (field.kind !== kind || !(item instanceof z.ZodObject) || !(item.shape.id instanceof z.ZodUUID))
    throw new ConfigurationError(`Embedded output must retain its UUID: ${field.name}`)

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
