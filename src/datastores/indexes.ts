import { z } from 'zod'

import type { DatabaseIndex } from '#datastores/backend.ts'
import { ConfigurationError } from '#errors'

const IndexMetadata = z.object({ unique: z.boolean().optional(), indexed: z.boolean().optional() })

/** Reads index metadata from the stored model, independently of public validators. */
export function modelIndexes(model: z.ZodObject): DatabaseIndex[] {
  const indexes: DatabaseIndex[] = []

  for (const [field, schema] of Object.entries(model.shape)) {
    const value = (schema as z.ZodType).meta()

    if (value === undefined) continue
    const metadata = IndexMetadata.safeParse(value)

    if (!metadata.success) throw new ConfigurationError('Invalid field index metadata', metadata.error.issues)
    if (metadata.data.unique || metadata.data.indexed) indexes.push({ field, unique: metadata.data.unique === true })
  }

  return indexes
}
