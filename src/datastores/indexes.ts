import { z } from 'zod'

import { DatabaseIndex } from '#datastores/backend.ts'
import { ConfigurationError } from '#errors'

const IndexMetadata = z.object({ unique: z.boolean().optional(), indexed: z.boolean().optional() })
const ModelMetadata = z.object({
  compoundUnique: z.array(z.strictObject({ fields: z.array(z.string()) })).optional(),
})

/** Reads index metadata from the stored model, independently of public validators. */
export function modelIndexes(model: z.ZodObject): DatabaseIndex[] {
  const indexes: DatabaseIndex[] = []

  for (const [field, schema] of Object.entries(model.shape)) {
    let current = schema as z.ZodType
    let unique: boolean | undefined
    let indexed: boolean | undefined

    while (true) {
      const metadata = IndexMetadata.safeParse(current.meta() ?? {})

      if (!metadata.success) throw new ConfigurationError('Invalid field index metadata', metadata.error.issues)
      unique ??= metadata.data.unique
      indexed ??= metadata.data.indexed
      if (!(current instanceof z.ZodOptional || current instanceof z.ZodNullable || current instanceof z.ZodDefault))
        break
      current = current.unwrap() as z.ZodType
    }
    if (unique || indexed) indexes.push({ field, unique: unique === true })
  }

  const metadata = ModelMetadata.safeParse(model.meta() ?? {})

  if (!metadata.success) throw new ConfigurationError('Invalid compound unique metadata', metadata.error.issues)

  for (const constraint of metadata.data.compoundUnique ?? []) {
    const index = DatabaseIndex.safeParse({ ...constraint, unique: true })

    if (!index.success || constraint.fields.some((field) => !Object.hasOwn(model.shape, field)))
      throw new ConfigurationError('Invalid compound unique fields')
    indexes.push(index.data)
  }

  return indexes
}
