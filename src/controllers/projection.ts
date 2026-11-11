import { z } from 'zod'

import type { DatabaseRecord } from '#datastores/backend.ts'
import type { HedraError } from '#errors'
import type { Collection } from '#models/collection.ts'
import type { ResourceInput } from '#models/rest.ts'
import { InputValidationError, OutputValidationError } from '#errors'
import { ResourceInput as InputSchema } from '#models/rest.ts'

/** Serializes a value only when JSON preserves it without loss. */
export function jsonString(value: unknown, ErrorClass: typeof HedraError = InputValidationError): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new ErrorClass('Resource values must be JSON compatible')
  const json = z.json().safeParse(value)

  if (!json.success) throw new ErrorClass('Resource values must be JSON compatible', json.error.issues)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new ErrorClass('Resource values must be JSON compatible')

  return data
}

/**
 * Projects declared public keys through the output validator. The clone protects
 * stored data from transforms; selecting keys before and after parsing limits exposure.
 * JSON and identity checks ensure the projected result remains valid and addressable.
 */
export function project(collection: Collection, record: DatabaseRecord): ResourceInput {
  const publicKeys = Object.keys(collection.outputValidator.shape)
  const input = Object.fromEntries(
    publicKeys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]),
  )
  const parsedOutput = collection.outputValidator.safeParse(structuredClone(input))

  if (!parsedOutput.success) throw new OutputValidationError('output validation error', parsedOutput.error.issues)
  const parsed = parsedOutput.data
  const output = Object.fromEntries(
    publicKeys.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]),
  )
  const jsonOutput: unknown = JSON.parse(jsonString(output, OutputValidationError))
  const parsedResource = InputSchema.safeParse(jsonOutput)

  if (!parsedResource.success) throw new OutputValidationError('output validation error', parsedResource.error.issues)
  const validated = parsedResource.data

  if (Object.hasOwn(validated, 'id') && record.id !== validated.id)
    throw new OutputValidationError('Output changed resource identity')

  // Preserve literal JSON property names that the schema parser may omit.
  return { ...validated, ...(jsonOutput as ResourceInput) }
}
