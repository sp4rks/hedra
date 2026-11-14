import { z } from 'zod'

import type { DatabaseIndex } from '#datastores/backend.ts'
import { ConfigurationError } from '#errors'

const Constraints = z.strictObject({ unique: z.boolean().optional(), indexed: z.boolean().optional() })

/** Reads persistence constraints from the stored model, independently of public validators. */
export function modelIndexes(model: z.ZodObject): DatabaseIndex[] {
  const indexes: DatabaseIndex[] = []

  for (const [field, schema] of Object.entries(model.shape)) {
    const value = (schema as z.ZodType).meta()?.constraints

    if (value === undefined) continue
    const constraints = Constraints.safeParse(value)

    if (!constraints.success) throw new ConfigurationError('Invalid field constraints', constraints.error.issues)
    if (constraints.data.unique || constraints.data.indexed)
      indexes.push({ field, unique: constraints.data.unique === true })
  }

  return indexes
}
