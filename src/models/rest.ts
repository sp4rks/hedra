import { z } from 'zod'

import { DatabaseFilter } from '#datastores/backend.ts'

export const ResourceInput = z.record(z.string(), z.json())

export type ResourceInput = z.infer<typeof ResourceInput>

export const QueryParams = z.strictObject({ filter: DatabaseFilter.optional() })

export type QueryParams = z.infer<typeof QueryParams>

const ResponseLinks = z.object({ self: z.url() })

export const JsonApiResponse = z.object({ data: ResourceInput, links: ResponseLinks })

export type JsonApiResponse = z.infer<typeof JsonApiResponse>

export const JsonApiListResponse = z.object({
  data: z.array(ResourceInput),
  links: ResponseLinks,
})

export type JsonApiListResponse = z.infer<typeof JsonApiListResponse>

export const ErrorResponse = z.object({
  errors: z.array(
    z.object({ status: z.number().int().min(400).max(599), title: z.string(), detail: z.json().optional() }),
  ),
})

export type ErrorResponse = z.infer<typeof ErrorResponse>
