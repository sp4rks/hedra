import { z } from 'zod'

import { ConfigurationError, InputValidationError } from '#errors'
import { assertResourceModel } from '#models/resource.ts'

export type ChildField = {
  name: string
  kind: 'array' | 'dictionary' | 'single' | 'object'
  model: z.ZodObject
  schema: z.ZodType
  key?: z.ZodType
}

/** Removes wrappers that preserve the underlying child placement. */
function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema

  while (current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault)
    current = current.unwrap() as z.ZodType

  return current
}

/** Validates managed flags while permitting unrelated schema metadata. */
function isChild(schema: z.ZodType): boolean {
  const metadata = z.object({ child: z.boolean().optional() }).safeParse(schema.meta() ?? {})

  if (!metadata.success) throw new ConfigurationError('Invalid child metadata', metadata.error.issues)

  return metadata.data.child === true
}

/** Finds managed definitions even inside unsupported compositions and recursive schemas. */
function containsChild(schema: z.ZodType, seen = new Set<z.ZodType>()): boolean {
  if (seen.has(schema)) return false
  seen.add(schema)
  if (isChild(schema)) return true
  if (schema instanceof z.ZodLazy) return containsChild(schema.unwrap() as z.ZodType, seen)
  /** Visits schema definition values without traversing application callbacks. */
  const contains = (value: unknown): boolean => {
    if (value instanceof z.ZodType) return containsChild(value, seen)
    if (Array.isArray(value)) return value.some(contains)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
      return Object.values(value).some(contains)

    return false
  }

  return Object.values(schema.def).some(contains)
}

/** Validates a decoded dictionary key that can occupy exactly one URI segment. */
export function safeChildKey(value: string): string {
  if (!value || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(value) || /[/\\\p{Cc}]/u.test(value))
    throw new InputValidationError('Unsafe child key')
  try {
    encodeURIComponent(value)
  } catch {
    throw new InputValidationError('Invalid child URI encoding')
  }

  return value
}

/** Keeps static field names free of route syntax and prototype selectors. */
function assertChildField(name: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(name) || ['__proto__', 'constructor', 'prototype'].includes(name))
    throw new ConfigurationError('Unsafe child field name')
}

/** Discovers direct managed placements; ordinary nested resources remain ordinary data. */
export function childFields(model: z.ZodObject): ChildField[] {
  const fields: ChildField[] = []

  for (const [name, raw] of Object.entries(model.shape)) {
    const schema = raw as z.ZodType
    const container = unwrap(schema)
    const kind = container instanceof z.ZodArray ? 'array' : container instanceof z.ZodRecord ? 'dictionary' : 'single'
    const entry =
      container instanceof z.ZodArray
        ? (container.element as z.ZodType)
        : container instanceof z.ZodRecord
          ? (container.valueType as z.ZodType)
          : container
    const item = unwrap(entry)

    if (kind !== 'single' && item !== entry && containsChild(entry))
      throw new ConfigurationError(`Unsupported child collection item wrapper: ${name}`)

    if (item instanceof z.ZodObject && isChild(item)) {
      assertChildField(name)
      assertResourceModel(item)
      if (!item.shape.environmentDomain || !item.shape.createdAt || !item.shape.updatedAt)
        throw new ConfigurationError('Children require resource metadata')
      fields.push({
        name,
        kind,
        model: item,
        schema,
        ...(container instanceof z.ZodRecord ? { key: container.keyType as z.ZodType } : {}),
      })
    } else if (container instanceof z.ZodObject && containsChild(container)) {
      assertChildField(name)
      fields.push({ name, kind: 'object', model: container, schema })
    } else if (containsChild(schema)) throw new ConfigurationError(`Unsupported child placement: ${name}`)
  }

  return fields
}

/** Rejects recursive managed paths before controllers, tables or routes are created. */
export function assertChildren(model: z.ZodObject, ancestors = new Set<z.ZodObject>()): void {
  if (ancestors.has(model)) throw new ConfigurationError('Recursive child paths are not supported')
  const path = new Set(ancestors).add(model)

  for (const field of childFields(model)) assertChildren(field.model, path)
}

/** Replaces managed container items while retaining optional, default and container constraints. */
function replaceItem(schema: z.ZodType, item: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDefault) return replaceItem(schema.unwrap() as z.ZodType, item).optional()
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable)
    return schema.clone({ ...schema.def, innerType: replaceItem(schema.unwrap() as z.ZodType, item) } as never)
  if (schema instanceof z.ZodArray) return schema.clone({ ...schema.def, element: item } as never)
  if (schema instanceof z.ZodRecord) return schema.clone({ ...schema.def, valueType: item } as never)

  return item
}

/** Derives HTTP attributes without requiring client-generated child identities or audits. */
export function childInput(model: z.ZodObject, partial: boolean, nested = false, managed = true): z.ZodObject {
  const mask = Object.fromEntries(
    (managed ? ['id', 'createdAt', 'updatedAt', 'environmentDomain'] : [])
      .filter((key) => Object.hasOwn(model.shape, key))
      .map((key) => [key, true]),
  )
  let input = model.clone({ ...model.def, checks: [] } as never).omit(mask as never)
  const fields = childFields(model).map((field) => [
    field.name,
    replaceItem(field.schema, childInput(field.model, false, field.kind !== 'object', field.kind !== 'object')),
  ])

  if (fields.length) input = input.extend(Object.fromEntries(fields))
  if (nested)
    input = input.extend({
      id: z.unknown().optional(),
      createdAt: z.unknown().optional(),
      updatedAt: z.unknown().optional(),
    })

  return partial ? input.partial() : input
}

/** Rejects submitted child ownership before stripping validators can erase it. */
export function assertChildOwnership(model: z.ZodObject, input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return
  const object = input as Record<string, unknown>

  for (const field of childFields(model)) {
    const value = object[field.name]
    const items =
      field.kind === 'array' && Array.isArray(value)
        ? value
        : field.kind === 'dictionary' && value && typeof value === 'object'
          ? Object.values(value)
          : [value]

    for (const item of items) {
      if (field.kind !== 'object' && item && typeof item === 'object' && Object.hasOwn(item, 'environmentDomain'))
        throw new InputValidationError('Child ownership is managed by the server')
      assertChildOwnership(field.model, item)
    }
  }
}
