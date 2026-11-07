import type { Context } from 'hono'
import { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { Collection } from '#models/collection.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import {
  addAssociation,
  assertAssociationScope,
  assertUnassociated,
  associationTable,
} from '#controllers/associations.ts'
import { embeddedId, embeddedList, embeddedMutate, prepareEmbedded } from '#controllers/embedded.ts'
import { jsonString, project } from '#controllers/projection.ts'
import { validateCandidate } from '#controllers/validation.ts'
import { DatabaseFilter as FilterSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { HedraError, InputValidationError, OutputValidationError, parseInput, RecordNotFoundError } from '#errors'
import { ResourceId, ResourceTimestamp } from '#models/resource.ts'
import { ResourceInput as InputSchema, QueryParams as QuerySchema } from '#models/rest.ts'
import { getAssociationScope, getEmbeddedScope } from '#models/scope.ts'

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
  const value = { ...parsed, ...input }

  delete value.id
  delete value.createdAt
  delete value.updatedAt
  const stored: unknown = JSON.parse(jsonString(value))
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
    const scope = getEmbeddedScope(context)

    if (scope)
      return (await embeddedMutate(
        this.backend,
        collection,
        context,
        scope,
        'create',
        attributes(input),
      )) as JsonApiResponse
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const fields = prepareEmbedded(collection.model, attributes(input), undefined, timestamp)
    const record: DatabaseRecord = { ...fields, id, createdAt: timestamp, updatedAt: timestamp }
    const ancestors = getAssociationScope(context)
    let data: ResourceInput | undefined

    await this.backend.transaction((transaction) => {
      if (ancestors) {
        assertAssociationScope(transaction, ancestors)
      }
      const validated = validateCandidate(collection.model, record)

      data = project(collection, validated)
      transaction.insert(collection.name, validated)
      if (ancestors) {
        const source = ancestors.at(-1)

        if (!source) throw new HedraError('Missing association source')
        addAssociation(transaction, source, { collection: collection.name, id })
      }
    })
    if (!data) throw new HedraError('Backend did not apply the resource create')

    return { data, links: { self: resourceLink(context, id) } }
  }

  /** Returns one resource. */
  async id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse> {
    const scope = getEmbeddedScope(context)

    if (scope) return await embeddedId(this.backend, collection, context, scope)
    const key = parseInput(ResourceId, id)
    const ancestors = getAssociationScope(context)
    const rows = ancestors
      ? await this.backend.transaction((transaction) => {
          assertAssociationScope(transaction, ancestors, { collection: collection.name, id: key })

          return transaction.select(collection.name, { id: key })
        })
      : await this.backend.select(collection.name, { id: key })
    const record = rows[0]

    if (!record) throw new RecordNotFoundError()
    if (record.id !== key) throw new HedraError('Resource ID cannot change')

    return { data: project(collection, record), links: { self: resourceLink(context, key) } }
  }

  /** Returns matching resources. */
  async list(
    context: Context,
    collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    const options = queryParams === undefined ? {} : queryParams

    parseInput(QuerySchema, options)
    if (Object.getOwnPropertySymbols(options).length)
      throw new InputValidationError('Query parameter keys must be strings')
    const snapshot = Object.fromEntries(Object.entries(options))

    parseInput(QuerySchema, snapshot)
    const filter = snapshot.filter ?? {}

    parseInput(FilterSchema, filter)
    if (Object.getOwnPropertySymbols(filter).length) throw new InputValidationError('Filter keys must be strings')
    const entries = Object.entries(filter).map(([key, value]) => [key, parseInput(ScalarSchema, value)] as const)
    const scope = getEmbeddedScope(context)
    const url = z.url().safeParse(baseUrl)

    if (!url.success) throw new OutputValidationError('output validation error', url.error.issues)

    if (scope)
      return await embeddedList(this.backend, collection, context, scope, url.data, Object.fromEntries(entries))
    const ancestors = getAssociationScope(context)
    const records = ancestors
      ? await this.backend.transaction((transaction) => {
          assertAssociationScope(transaction, ancestors)
          const source = ancestors.at(-1)

          if (!source) throw new HedraError('Missing association source')
          const links = transaction.select(associationTable, {
            sourceCollection: source.collection,
            sourceId: source.id,
            targetCollection: collection.name,
          })
          const ids = new Set(links.map((link) => link.targetId))

          return transaction.select(collection.name, Object.fromEntries(entries)).filter((record) => ids.has(record.id))
        })
      : await this.backend.select(collection.name, Object.fromEntries(entries))

    return { data: records.map((record) => project(collection, record)), links: { self: url.data } }
  }

  /** Updates one resource. */
  async update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    const scope = getEmbeddedScope(context)

    if (scope)
      return (await embeddedMutate(
        this.backend,
        collection,
        context,
        scope,
        'update',
        attributes(input),
      )) as JsonApiResponse
    const key = parseInput(ResourceId, id)
    const fields = attributes(input)
    let data: ResourceInput | undefined
    const modify = (current: DatabaseRecord): DatabaseRecord => {
      if (current.id !== key) throw new HedraError('Resource ID cannot change')
      const parsedTimestamp = ResourceTimestamp.safeParse(current.createdAt)

      if (!parsedTimestamp.success)
        throw new OutputValidationError('output validation error', parsedTimestamp.error.issues)
      const createdAt = parsedTimestamp.data
      const timestamp = new Date().toISOString()
      const prepared = prepareEmbedded(collection.model, fields, current, timestamp)
      const updated = validateCandidate(collection.model, {
        ...current,
        ...prepared,
        id: key,
        createdAt,
        updatedAt: timestamp,
      })

      data = project(collection, updated)

      return updated
    }
    const ancestors = getAssociationScope(context)
    const result = ancestors
      ? await this.backend.transaction((transaction) => {
          assertAssociationScope(transaction, ancestors, { collection: collection.name, id: key })

          return transaction.update(collection.name, key, modify)
        })
      : await this.backend.update(collection.name, key, modify)

    if (!result) throw new RecordNotFoundError()
    if (!data) throw new HedraError('Backend did not apply the resource update')

    return { data, links: { self: resourceLink(context, key) } }
  }

  /** Deletes one resource. */
  async delete(context: Context, collection: Collection, id: string): Promise<void> {
    const scope = getEmbeddedScope(context)

    if (scope) {
      await embeddedMutate(this.backend, collection, context, scope, 'delete')

      return
    }
    const key = parseInput(ResourceId, id)
    const ancestors = getAssociationScope(context)

    await this.backend.transaction((transaction) => {
      assertAssociationScope(transaction, ancestors ?? [], { collection: collection.name, id: key })
      assertUnassociated(transaction, { collection: collection.name, id: key })
      if (!transaction.delete(collection.name, key)) throw new RecordNotFoundError()
    })
  }
}
