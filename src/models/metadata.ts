import { z } from 'zod'

export const ResourceId = z.uuid()
export const ResourceTimestamp = z.iso.datetime()

export const ResourceMetadata = z.object({
  id: ResourceId,
  createdAt: ResourceTimestamp,
  updatedAt: ResourceTimestamp,
})
