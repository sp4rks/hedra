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

/**
 * Ensures retained embedded resources keep their stored identities. Output may hide
 * fields or filter and reorder arrays, but dictionary keys must keep their identities.
 * The root ID is checked if exposed; retained embedded IDs must match their originals.
 */
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
      const storedItemsById = new Map<unknown, ObjectValue>()

      for (const item of stored) {
        if (!isObject(item) || typeof item.id !== 'string' || storedItemsById.has(item.id)) {
          throw new OutputValidationError('Invalid stored embedded identity')
        }
        storedItemsById.set(item.id, item)
      }
      const projectedIds = new Set<unknown>()

      for (const item of value) {
        if (!isObject(item) || projectedIds.has(item.id))
          throw new OutputValidationError('Output changed embedded identity')
        const storedItem = storedItemsById.get(item.id)

        if (!storedItem) throw new OutputValidationError('Output changed embedded identity')
        projectedIds.add(item.id)
        assertIdentities(field.model, storedItem, item, true)
      }
    } else if (field.kind === 'dictionary') {
      if (!isObject(stored) || !isObject(value)) throw new OutputValidationError('Output changed embedded identity')

      for (const [key, item] of Object.entries(value)) {
        const storedItem = Object.hasOwn(stored, key) ? stored[key] : undefined

        if (!isObject(storedItem) || !isObject(item))
          throw new OutputValidationError('Output changed embedded identity')
        assertIdentities(field.model, storedItem, item, true)
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

/**
 * Projects declared public keys through the output validator. The clone protects
 * stored data from transforms; selecting keys before and after parsing limits exposure.
 * JSON and identity checks ensure the projected result remains valid and addressable.
 */
export function project(collection: Collection, record: DatabaseRecord): ResourceInput {
  try {
    const publicKeys = Object.keys(collection.outputValidator.shape)
    const input = Object.fromEntries(
      publicKeys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]),
    )
    const parsed = collection.outputValidator.parse(structuredClone(input))
    const output = Object.fromEntries(
      publicKeys.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]),
    )
    const jsonOutput: unknown = JSON.parse(jsonString(output, OutputValidationError))
    const validated = InputSchema.parse(jsonOutput)

    assertIdentities(collection.model, record, validated)

    // Preserve literal JSON property names that the schema parser may omit.
    return { ...validated, ...(jsonOutput as ResourceInput) }
  } catch (error) {
    throw hedraError(error, OutputValidationError)
  }
}
