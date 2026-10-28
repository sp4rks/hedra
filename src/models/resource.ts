import { z } from 'zod'

/** The base fields stored on a Hedra record. */
export const Resource = z.object({
  id: z
    .uuid()
    .describe('The unique identifier for the resource')
    .meta({ example: '123e4567-e89b-12d3-a456-426614174000' }),
  name: z.string().trim().min(2).max(64).describe('The name of the object').meta({ example: 'Acme Widgets' }),
  description: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .nullish()
    .describe('The description of the object')
    .meta({ example: 'A widget company' }),
  createdAt: z.iso.datetime().describe('The date and time the object was created').meta({
    format: 'date-time',
    example: '2025-06-01T10:45:29.323Z',
  }),
  updatedAt: z.iso.datetime().describe('The date and time the object was last updated').meta({
    format: 'date-time',
    example: '2025-06-01T10:45:29.323Z',
  }),
})

export type Resource = z.infer<typeof Resource>
