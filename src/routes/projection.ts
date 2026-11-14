import type { z } from 'zod'

import type { ResourceInput } from '#models/rest.ts'
import { jsonString } from '#controllers/validation.ts'
import { OutputValidationError } from '#errors'
import { ResourceInput as InputSchema } from '#models/rest.ts'

/**
 * Projects declared public keys through the output validator. The clone protects
 * stored data from transforms; selecting keys before and after parsing limits exposure.
 * JSON and identity checks ensure the projected result remains valid and addressable.
 */
export function project(schema: z.ZodObject, record: ResourceInput): ResourceInput {
  const publicKeys = Object.keys(schema.shape)
  const input = Object.fromEntries(
    publicKeys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]),
  )
  const parsedOutput = schema.safeParse(structuredClone(input))

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
