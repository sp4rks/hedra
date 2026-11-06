import type { Context } from 'hono'
import { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { Collection } from '#models/collection.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { DatabaseFilter as FilterSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { RecordNotFoundError } from '#errors'
import { ResourceId, ResourceTimestamp } from '#models/resource.ts'
import { ResourceInput as InputSchema, QueryParams as QuerySchema } from '#models/rest.ts'

export interface ControllerInterface {
  create(context: Context, collection: Collection, input: ResourceInput): Promise<JsonApiResponse>
  id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse>
  list(
    context: Context,
    collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse>
  update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse>
  delete(context: Context, collection: Collection, id: string): Promise<void>
}

/** Serializes a value only when JSON preserves it without loss. */
function jsonString(value: unknown): string {
  const data = JSON.stringify(value)

  if (data === undefined) throw new Error('Resource values must be JSON compatible')
  z.json().parse(value)
  if (!Bun.deepEquals(value, JSON.parse(data))) throw new Error('Resource values must be JSON compatible')

  return data
}

/** Removes server-owned attributes before generic JSON validation. */
function attributes(input: ResourceInput): ResourceInput {
  const parsed = z.record(z.string(), z.unknown()).parse(input)
  const value = { ...parsed, ...input }

  delete value.id
  delete value.createdAt
  delete value.updatedAt
  const stored: unknown = JSON.parse(jsonString(value))
  const validated = InputSchema.parse(stored)

  return { ...validated, ...(stored as ResourceInput) }
}

/** Applies the collection's validator to declared public keys only. */
function project(collection: Collection, record: DatabaseRecord): ResourceInput {
  const keys = Object.keys(collection.outputValidator.shape)
  const input = Object.fromEntries(keys.filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]]))
  const parsed = collection.outputValidator.parse(structuredClone(input))
  const output = Object.fromEntries(keys.filter((key) => Object.hasOwn(parsed, key)).map((key) => [key, parsed[key]]))
  const stored: unknown = JSON.parse(jsonString(output))
  const validated = InputSchema.parse(stored)

  return { ...validated, ...(stored as ResourceInput) }
}

/** Builds a resource link without carrying query parameters into the path. */
function resourceLink(context: Context, id: string): string {
  const url = new URL(context.req.url)

  url.search = ''
  url.hash = ''
  const path = url.pathname.replace(/\/+$/, '')

  url.pathname = path.endsWith(`/${id}`) ? path : `${path}/${id}`

  return url.toString()
}

export class BaseController implements ControllerInterface {
  /** Uses the supplied backend for each collection operation. */
  constructor(protected readonly backend: Backend) {}

  /** Creates a resource with server-owned identity and timestamps. */
  async create(context: Context, collection: Collection, input: ResourceInput): Promise<JsonApiResponse> {
    const fields = attributes(input)
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const record: DatabaseRecord = { ...fields, id, createdAt: timestamp, updatedAt: timestamp }
    const data = project(collection, record)

    await this.backend.insert(collection.name, record)

    return { data, links: { self: resourceLink(context, id) } }
  }

  /** Returns one resource. */
  async id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse> {
    const key = ResourceId.parse(id)
    const rows = await this.backend.select(collection.name, { id: key })
    const record = rows[0]

    if (!record) throw new RecordNotFoundError()
    if (record.id !== key) throw new Error('Resource ID cannot change')

    return { data: project(collection, record), links: { self: resourceLink(context, key) } }
  }

  /** Returns matching resources. */
  async list(
    _context: Context,
    collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    const options = queryParams === undefined ? {} : queryParams

    if (Object.getOwnPropertySymbols(options).length) throw new Error('Query parameter keys must be strings')
    QuerySchema.parse(options)
    const snapshot = Object.fromEntries(Object.entries(options))

    QuerySchema.parse(snapshot)
    const filter = snapshot.filter ?? {}

    if (Object.getOwnPropertySymbols(filter).length) throw new Error('Filter keys must be strings')
    FilterSchema.parse(filter)
    const entries = Object.entries(filter).map(([key, value]) => [key, ScalarSchema.parse(value)] as const)
    const records = await this.backend.select(collection.name, Object.fromEntries(entries))

    return { data: records.map((record) => project(collection, record)), links: { self: z.url().parse(baseUrl) } }
  }

  /** Updates one resource. */
  async update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    const key = ResourceId.parse(id)
    const fields = attributes(input)
    let data: ResourceInput | undefined
    const result = await this.backend.update(collection.name, key, (current) => {
      if (current.id !== key) throw new Error('Resource ID cannot change')
      const createdAt = ResourceTimestamp.parse(current.createdAt)
      const updated = { ...current, ...fields, id: key, createdAt, updatedAt: new Date().toISOString() }

      data = project(collection, updated)

      return updated
    })

    if (!result) throw new RecordNotFoundError()
    if (!data) throw new Error('Backend did not apply the resource update')

    return { data, links: { self: resourceLink(context, key) } }
  }

  /** Deletes one resource. */
  async delete(_context: Context, collection: Collection, id: string): Promise<void> {
    const key = ResourceId.parse(id)

    if (!(await this.backend.delete(collection.name, key))) throw new RecordNotFoundError()
  }
}
