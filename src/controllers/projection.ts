import { z } from 'zod'

import type { DatabaseRecord } from '#datastores/backend.ts'
import type { HedraError } from '#errors'
import type { Collection } from '#models/collection.ts'
import type { ResourceInput } from '#models/rest.ts'
import { hedraError, InputValidationError, OutputValidationError } from '#errors'
import { embeddedFields } from '#models/embedded.ts'
import { ResourceInput as InputSchema } from '#models/rest.ts'

type ObjectValue = Record<string, unknown>

/** Identifies an object without converting its keys or values. */
function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Ensures projected identities still identify the same stored resources. */
function assertIdentities(model: z.ZodObject, original: ObjectValue, visible: ObjectValue, embedded = false): void {
  if ((embedded || Object.hasOwn(visible, 'id')) && original.id !== visible.id) {
    throw new OutputValidationError('Output changed resource identity')
  }

  for (const field of embeddedFields(model)) {
    const value = visible[field.name]

    if (value === undefined || value === null) continue
    const stored = original[field.name]

    if (field.kind === 'array') {
      if (!Array.isArray(stored) || !Array.isArray(value))
        throw new OutputValidationError('Output changed embedded identity')
      const items = new Map<unknown, ObjectValue>()

      for (const item of stored) {
        if (!isObject(item) || typeof item.id !== 'string' || items.has(item.id)) {
          throw new OutputValidationError('Invalid stored embedded identity')
        }
        items.set(item.id, item)
      }
      const seen = new Set<unknown>()

      for (const item of value) {
        if (!isObject(item) || seen.has(item.id)) throw new OutputValidationError('Output changed embedded identity')
        const match = items.get(item.id)

        if (!match) throw new OutputValidationError('Output changed embedded identity')
        seen.add(item.id)
        assertIdentities(field.model, match, item, true)
      }
    } else if (field.kind === 'dictionary') {
      if (!isObject(stored) || !isObject(value)) throw new OutputValidationError('Output changed embedded identity')

      for (const [key, item] of Object.entries(value)) {
        const match = Object.hasOwn(stored, key) ? stored[key] : undefined

        if (!isObject(match) || !isObject(item)) throw new OutputValidationError('Output changed embedded identity')
        assertIdentities(field.model, match, item, true)
      }
    } else {
      if (!isObject(stored) || !isObject(value)) throw new OutputValidationError('Output changed embedded identity')
      assertIdentities(field.model, stored, value, true)
    }
  }
}

/** Serializes a value only when JSON preserves it without loss. */
export function jsonString(value: unknown, ErrorClass: typeof HedraError = InputValidationError): string {
  try {
    const data = JSON.stringify(value)

    if (data === undefined) throw new ErrorClass('Resource values must be JSON compatible')
    z.json().parse(value)
    if (!Bun.deepEquals(value, JSON.parse(data))) throw new ErrorClass('Resource values must be JSON compatible')

    return data
  } catch (error) {
    throw hedraError(error, ErrorClass)
  }
}

/** Applies the collection's validator to declared public keys only. */
export function project(collection: Collection, record: DatabaseRecord): ResourceInput {
  try {
    const keys = Object.keys(collection.outputValidator.shape)
    const input = Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]))
    const parsed = collection.outputValidator.parse(structuredClone(input))
    const output = Object.fromEntries(keys.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]))
    const stored: unknown = JSON.parse(jsonString(output, OutputValidationError))
    const validated = InputSchema.parse(stored)

    assertIdentities(collection.model, record, validated)

    return { ...validated, ...(stored as ResourceInput) }
  } catch (error) {
    throw hedraError(error, OutputValidationError)
  }
}
