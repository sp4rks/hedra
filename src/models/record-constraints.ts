import { z } from 'zod'

/**
 * Constraints stored on one field.
 * `unique` means no two records share the value.
 * `indexed` means a store may index the field, and it is meaningless when `unique` is set.
 */
export const RecordFieldConstraints = z
  .strictObject({
    unique: z.boolean().optional().describe("No two records share this field's value"),
    indexed: z.boolean().optional().describe('Records are often found by this field. Meaningless when unique is set'),
  })
  .describe('Constraints on one field')

export type RecordFieldConstraints = z.infer<typeof RecordFieldConstraints>

/**
 * Constraints stored on a record.
 * `compoundUnique` lists field sets that are unique together.
 */
export const RecordSchemaConstraints = z
  .strictObject({
    compoundUnique: z
      .array(
        z.strictObject({
          fields: z.array(z.string()),
        }),
      )
      .optional()
      .describe('Each entry lists fields whose values are unique together'),
  })
  .describe('Constraints on a whole record')

export type RecordSchemaConstraints = z.infer<typeof RecordSchemaConstraints>
