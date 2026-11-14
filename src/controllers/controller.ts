import type { Context } from 'hono'
import { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { Collection } from '#models/collection.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { assertResource, assertUnassociated } from '#controllers/associations.ts'
import { assertSafeKeys, jsonString, validateCandidate } from '#controllers/validation.ts'
import { DatabaseFilter as FilterSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { HedraError, InputValidationError, OutputValidationError, parseInput, RecordNotFoundError } from '#errors'
import { requireRequestScope } from '#models/request-scope.ts'
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

/** Removes server-owned attributes before generic JSON validation. */
function attributes(input: ResourceInput): ResourceInput {
  const parsed = parseInput(z.record(z.string(), z.unknown()), input)

  if (Object.hasOwn(input, 'environmentDomain')) throw new InputValidationError('Ownership is managed by the server')
  const value = { ...parsed, ...input }

  delete value.id
  delete value.createdAt
  delete value.updatedAt
  const stored: unknown = JSON.parse(jsonString(value))

  assertSafeKeys(stored)
  const validated = parseInput(InputSchema, stored)

  return { ...validated, ...(stored as ResourceInput) }
}

/** Builds a resource link without carrying query parameters into the path. */
export function resourceLink(context: Context, id: string): string {
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
    const { environment } = requireRequestScope(context)
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const fields = attributes(input)
    const record: DatabaseRecord = {
      ...fields,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      environmentDomain: environment.environmentDomain,
    }
    let data: ResourceInput | undefined

    await this.backend.transaction((transaction) => {
      const validated = validateCandidate(collection.model, record)

      transaction.insert(collection.name, validated)
      data = validated
    })
    if (!data) throw new HedraError('Backend did not apply the resource create')

    return { data, links: { self: resourceLink(context, id) } }
  }

  /** Returns one resource. */
  async id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse> {
    const { environment } = requireRequestScope(context)
    const key = parseInput(ResourceId, id)
    const rows = await this.backend.select(collection.name, {
      id: key,
      environmentDomain: environment.environmentDomain,
    })
    const record = rows[0]

    if (!record) throw new RecordNotFoundError()
    if (record.environmentDomain !== environment.environmentDomain) throw new RecordNotFoundError()
    if (record.id !== key) throw new HedraError('Resource ID cannot change')

    return { data: record, links: { self: resourceLink(context, key) } }
  }

  /** Returns matching resources. */
  async list(
    context: Context,
    collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    const { environment } = requireRequestScope(context)
    const options = queryParams === undefined ? {} : queryParams

    parseInput(QuerySchema, options)
    if (Object.getOwnPropertySymbols(options).length)
      throw new InputValidationError('Query parameter keys must be strings')
    const snapshot = Object.fromEntries(Object.entries(options))

    parseInput(QuerySchema, snapshot)
    const filter = snapshot.filter ?? {}

    parseInput(FilterSchema, filter)
    if (Object.getOwnPropertySymbols(filter).length) throw new InputValidationError('Filter keys must be strings')
    if (Object.keys(filter).some((key) => key === 'environmentDomain' || key.startsWith('environmentDomain[')))
      throw new InputValidationError('Ownership filters are managed by the server')
    const entries = Object.entries(filter).map(([key, value]) => [key, parseInput(ScalarSchema, value)] as const)
    const url = z.url().safeParse(baseUrl)

    if (!url.success) throw new OutputValidationError('output validation error', url.error.issues)

    const records = await this.backend.select(collection.name, {
      ...Object.fromEntries(entries),
      environmentDomain: environment.environmentDomain,
    })

    if (records.some((record) => record.environmentDomain !== environment.environmentDomain))
      throw new OutputValidationError('Resource ownership cannot change')

    return { data: records, links: { self: url.data } }
  }

  /** Updates one resource. */
  async update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    const { environment } = requireRequestScope(context)
    const key = parseInput(ResourceId, id)
    const fields = attributes(input)
    let data: ResourceInput | undefined
    const modify = (current: DatabaseRecord): DatabaseRecord => {
      if (current.environmentDomain !== environment.environmentDomain) throw new RecordNotFoundError()
      if (current.id !== key) throw new HedraError('Resource ID cannot change')
      const parsedTimestamp = ResourceTimestamp.safeParse(current.createdAt)

      if (!parsedTimestamp.success)
        throw new OutputValidationError('output validation error', parsedTimestamp.error.issues)
      const createdAt = parsedTimestamp.data
      const timestamp = new Date().toISOString()
      const updated = validateCandidate(collection.model, {
        ...current,
        ...fields,
        id: key,
        createdAt,
        updatedAt: timestamp,
      })

      data = updated

      return updated
    }
    const result = await this.backend.update(collection.name, key, modify)

    if (!result) throw new RecordNotFoundError()
    if (!data) throw new HedraError('Backend did not apply the resource update')

    return { data, links: { self: resourceLink(context, key) } }
  }

  /** Deletes one resource. */
  async delete(context: Context, collection: Collection, id: string): Promise<void> {
    const key = parseInput(ResourceId, id)

    const { environment } = requireRequestScope(context)

    await this.backend.transaction((transaction) => {
      assertResource(transaction, { collection: collection.name, id: key }, environment.environmentDomain)
      assertUnassociated(transaction, { collection: collection.name, id: key }, environment.environmentDomain)
      if (!transaction.delete(collection.name, key)) throw new RecordNotFoundError()
    })
  }
}
