import { z } from 'zod'

import type { DatabaseRecord } from '#datastores/backend.ts'
import type { Collection } from '#models/collection.ts'
import type { ResourceInput } from '#models/rest.ts'
import { ResourceInput as InputSchema } from '#models/rest.ts'

/** Serializes a value only when JSON preserves it without loss. */
export function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new Error('Resource values must be JSON compatible')
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new Error('Resource values must be JSON compatible')

  return data
}

/** Applies the collection's validator to declared public keys only. */
export function project(collection: Collection, record: DatabaseRecord): ResourceInput {
  const keys = Object.keys(collection.outputValidator.shape)
  const input = Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]))
  const parsed = collection.outputValidator.parse(structuredClone(input))
  const output = Object.fromEntries(keys.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]))
  const stored: unknown = JSON.parse(jsonString(output))
  const validated = InputSchema.parse(stored)

  return { ...validated, ...(stored as ResourceInput) }
}
