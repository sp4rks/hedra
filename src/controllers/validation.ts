import { z } from 'zod'

import type { DatabaseRecord } from '#datastores/backend.ts'
import type { HedraError } from '#errors'
import { InputValidationError } from '#errors'

type ObjectValue = Record<string, unknown>
const metadata = ['id', 'createdAt', 'updatedAt', 'environmentDomain'] as const

/** Serializes a value only when JSON preserves it without loss. */
export function jsonString(value: unknown, ErrorClass: typeof HedraError = InputValidationError): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new ErrorClass('Resource values must be JSON compatible')
  const json = z.json().safeParse(value)

  if (!json.success) throw new ErrorClass('Resource values must be JSON compatible', json.error.issues)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new ErrorClass('Resource values must be JSON compatible')

  return data
}

/** Rejects keys that Zod would otherwise silently discard while parsing JSON. */
export function assertSafeKeys(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  if (Object.hasOwn(value, '__proto__')) throw new InputValidationError('Unsafe JSON key')

  for (const item of Object.values(value)) assertSafeKeys(item)
}

/** Identifies a JSON object without changing its literal keys. */
function isObject(value: unknown): value is ObjectValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validates a complete mutation candidate without allowing model code to replace managed metadata. */
export function validateCandidate(model: z.ZodObject, candidate: DatabaseRecord): DatabaseRecord {
  assertSafeKeys(candidate)
  const parsed = model.safeParse(structuredClone(candidate))

  if (!parsed.success) throw new InputValidationError('input validation error', parsed.error.issues)
  if (!isObject(parsed.data)) throw new InputValidationError()

  const validated = { ...parsed.data }

  for (const key of metadata) {
    if (!Object.hasOwn(validated, key) || validated[key] !== candidate[key])
      throw new InputValidationError('model changed managed metadata')
  }

  return validated as DatabaseRecord
}
