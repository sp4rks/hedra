import type { z } from 'zod'

import { OutputValidationError } from '#errors'
import { ResourceTimestamp } from '#models/resource.ts'

/** Validates internal deletion metadata and returns a public catalogue value. */
export function catalogueRecord<S extends z.ZodObject>(
  model: S,
  input: unknown,
): { value: z.output<S>; deleted: boolean } {
  const parsed = model.extend({ deletedAt: ResourceTimestamp.optional() }).safeParse(input)

  if (!parsed.success) throw new OutputValidationError('output validation error', parsed.error.issues)
  const { deletedAt, ...attributes } = parsed.data
  const value = model.safeParse(attributes)

  if (!value.success) throw new OutputValidationError('output validation error', value.error.issues)

  return { value: value.data, deleted: deletedAt !== undefined }
}
