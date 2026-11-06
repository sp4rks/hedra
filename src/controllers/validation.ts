import type { z } from 'zod'

import type { DatabaseRecord } from '#datastores/backend.ts'
import { InputValidationError } from '#errors'
import { embeddedFields } from '#models/embedded.ts'

type ObjectValue = Record<string, unknown>
const metadata = ['id', 'createdAt', 'updatedAt'] as const

/** Identifies a JSON object without changing its literal keys. */
function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Removes only generated metadata not declared by the relevant stored model. */
function declared(model: z.ZodObject, record: ObjectValue): ObjectValue {
  const entries = Object.entries(record).filter(
    ([key]) => !metadata.includes(key as (typeof metadata)[number]) || Object.hasOwn(model.shape, key),
  )
  const result = Object.fromEntries(entries)

  for (const field of embeddedFields(model)) {
    const value = result[field.name]

    if (field.kind === 'array' && Array.isArray(value)) {
      result[field.name] = value.map((item) => (isObject(item) ? declared(field.model, item) : item))
    } else if (field.kind === 'dictionary' && isObject(value)) {
      result[field.name] = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, isObject(item) ? declared(field.model, item) : item]),
      )
    } else if (field.kind === 'single' && isObject(value)) result[field.name] = declared(field.model, value)
  }

  return result
}

/** Restores controller-owned metadata while retaining parsed ordinary attributes. */
function restore(model: z.ZodObject, original: ObjectValue, validated: ObjectValue): ObjectValue {
  const result = { ...validated }

  for (const key of metadata) {
    if (Object.hasOwn(original, key))
      Object.defineProperty(result, key, { value: original[key], enumerable: true, writable: true, configurable: true })
  }

  for (const field of embeddedFields(model)) {
    const before = original[field.name]
    const after = validated[field.name]

    if (after === undefined || after === null) {
      if (before !== undefined && before !== null)
        throw new InputValidationError(422, 'model changed embedded identity')
      continue
    }
    if (field.kind === 'array' && Array.isArray(after)) {
      if (before === undefined && after.length === 0) continue
      if (!Array.isArray(before) || before.length !== after.length)
        throw new InputValidationError(422, 'model changed embedded identity')
      const byId = new Map(before.filter(isObject).map((item) => [item.id, item]))
      const seen = new Set<unknown>()

      result[field.name] = after.map((item) => {
        if (!isObject(item) || seen.has(item.id)) throw new InputValidationError(422, 'model changed embedded identity')
        const previous = byId.get(item.id)

        if (!previous) throw new InputValidationError(422, 'model changed embedded identity')
        seen.add(item.id)

        return restore(field.model, previous, item)
      })
    } else if (field.kind === 'dictionary' && isObject(after)) {
      if (before === undefined && Object.keys(after).length === 0) continue
      if (!isObject(before) || Object.keys(before).length !== Object.keys(after).length)
        throw new InputValidationError(422, 'model changed embedded identity')
      result[field.name] = Object.fromEntries(
        Object.entries(after).map(([key, item]) => {
          const previous = Object.hasOwn(before, key) ? before[key] : undefined

          if (!isObject(previous) || !isObject(item) || previous.id !== item.id)
            throw new InputValidationError(422, 'model changed embedded identity')

          return [key, restore(field.model, previous, item)]
        }),
      )
    } else if (field.kind === 'single' && isObject(after)) {
      if (!isObject(before) || before.id !== after.id)
        throw new InputValidationError(422, 'model changed embedded identity')
      result[field.name] = restore(field.model, before, after)
    } else throw new InputValidationError(422, 'model changed embedded identity')
  }

  return result
}

/** Validates a complete mutation candidate without allowing model code to replace managed metadata. */
export function validateCandidate(model: z.ZodObject, candidate: DatabaseRecord): DatabaseRecord {
  const input = declared(model, structuredClone(candidate))
  const parsed = model.safeParse(input)

  if (!parsed.success) throw new InputValidationError(422, 'input validation error', parsed.error.issues)
  if (!isObject(parsed.data)) throw new InputValidationError()

  return restore(model, candidate, parsed.data) as DatabaseRecord
}
