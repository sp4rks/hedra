import type { Context } from 'hono'
import { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { assertResource, assertUnassociated } from '#controllers/associations.ts'
import {
  assertChildInput,
  assertChildMetadata,
  assertChildValues,
  childTarget,
  mutateChildren,
  prepareChildren,
  readChildren,
} from '#controllers/children.ts'
import { assertSafeKeys, jsonString, validateCandidate } from '#controllers/validation.ts'
import { DatabaseFilter as FilterSchema, DatabaseScalar as ScalarSchema } from '#datastores/backend.ts'
import { HedraError, InputValidationError, OutputValidationError, parseInput, RecordNotFoundError } from '#errors'
import { assertChildOwnership } from '#models/children.ts'
import { requireRequestScope } from '#models/request-scope.ts'
import { ResourceId, ResourceTimestamp, resourceName } from '#models/resource.ts'
import { ResourceInput as InputSchema, QueryParams as QuerySchema } from '#models/rest.ts'

/**
 * Operates on the raw root schema. Child-scoped calls return the complete containing root;
 * list returns a one-root envelope so web can apply the parent's output before selecting children.
 */
export interface ControllerInterface {
  create(context: Context, model: z.ZodObject, input: ResourceInput): Promise<JsonApiResponse>
  id(context: Context, model: z.ZodObject, id: string): Promise<JsonApiResponse>
  list(context: Context, model: z.ZodObject, baseUrl: string, queryParams?: QueryParams): Promise<JsonApiListResponse>
  update(context: Context, model: z.ZodObject, input: ResourceInput, id: string): Promise<JsonApiResponse>
  delete(context: Context, model: z.ZodObject, id: string): Promise<void>
}

/** Removes server-owned attributes before generic JSON validation. */
function attributes(input: ResourceInput): ResourceInput {
  const parsed = parseInput(z.record(z.string(), z.unknown()), input)

  if (Object.hasOwn(input, 'environmentDomain') || Object.hasOwn(parsed, 'environmentDomain'))
    throw new InputValidationError('Ownership is managed by the server')
  const value = { ...parsed, ...input }

  if (Object.hasOwn(value, 'environmentDomain')) throw new InputValidationError('Ownership is managed by the server')

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

/** Returns complete root snapshots for both root and child-scoped calls; web owns child projection. */
export class BaseController implements ControllerInterface {
  /** Uses the supplied backend for each model operation. */
  constructor(protected readonly backend: Backend) {}

  /** Creates a resource with server-owned identity and timestamps. */
  async create(context: Context, model: z.ZodObject, input: ResourceInput): Promise<JsonApiResponse> {
    const target = childTarget(context)

    if (target) {
      assertChildInput(model, target, input)

      return mutateChildren(this.backend, context, model, target, 'create', attributes(input))
    }
    const { environment } = requireRequestScope(context)

    assertChildOwnership(model, input)
    const id = crypto.randomUUID()
    const timestamp = new Date().toISOString()
    const fields = attributes(input)
    const record: DatabaseRecord = {
      ...prepareChildren(model, fields, undefined, timestamp, environment.environmentDomain),
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      environmentDomain: environment.environmentDomain,
    }
    let data: ResourceInput | undefined

    await this.backend.transaction((transaction) => {
      const validated = validateCandidate(model, record)

      assertChildMetadata(model, record, validated)
      assertChildValues(model, validated, environment.environmentDomain, InputValidationError)

      transaction.insert(resourceName(model), validated)
      data = validated
    })
    if (!data) throw new HedraError('Backend did not apply the resource create')

    return { data, links: { self: resourceLink(context, id) } }
  }

  /** Returns one resource. */
  async id(context: Context, model: z.ZodObject, id: string): Promise<JsonApiResponse> {
    const target = childTarget(context)

    if (target)
      return { data: await readChildren(this.backend, context, model, target), links: { self: context.req.url } }
    const { environment } = requireRequestScope(context)
    const key = parseInput(ResourceId, id)
    const rows = await this.backend.select(resourceName(model), {
      id: key,
      environmentDomain: environment.environmentDomain,
    })
    const record = rows[0]

    if (!record) throw new RecordNotFoundError()
    if (record.environmentDomain !== environment.environmentDomain) throw new RecordNotFoundError()
    if (record.id !== key) throw new HedraError('Resource ID cannot change')
    assertChildValues(model, record, environment.environmentDomain, OutputValidationError)

    return { data: record, links: { self: resourceLink(context, key) } }
  }

  /** Returns matching resources. */
  async list(
    context: Context,
    model: z.ZodObject,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    const target = childTarget(context)

    if (target) return { data: [await readChildren(this.backend, context, model, target)], links: { self: baseUrl } }
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

    const records = await this.backend.select(resourceName(model), {
      ...Object.fromEntries(entries),
      environmentDomain: environment.environmentDomain,
    })

    if (records.some((record) => record.environmentDomain !== environment.environmentDomain))
      throw new OutputValidationError('Resource ownership cannot change')

    for (const record of records) assertChildValues(model, record, environment.environmentDomain, OutputValidationError)

    return { data: records, links: { self: url.data } }
  }

  /** Updates one resource. */
  async update(context: Context, model: z.ZodObject, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    const target = childTarget(context)

    if (target) {
      assertChildInput(model, target, input)

      return mutateChildren(this.backend, context, model, target, 'update', attributes(input))
    }
    const { environment } = requireRequestScope(context)
    const key = parseInput(ResourceId, id)

    assertChildOwnership(model, input)
    const fields = attributes(input)
    let data: ResourceInput | undefined
    const modify = (current: DatabaseRecord): DatabaseRecord => {
      if (current.environmentDomain !== environment.environmentDomain) throw new RecordNotFoundError()
      if (current.id !== key) throw new HedraError('Resource ID cannot change')
      assertChildValues(model, current, environment.environmentDomain, OutputValidationError)
      const parsedTimestamp = ResourceTimestamp.safeParse(current.createdAt)

      if (!parsedTimestamp.success)
        throw new OutputValidationError('output validation error', parsedTimestamp.error.issues)
      const createdAt = parsedTimestamp.data
      const timestamp = new Date().toISOString()
      const candidate = {
        ...current,
        ...prepareChildren(model, fields, current, timestamp, environment.environmentDomain),
        id: key,
        createdAt,
        updatedAt: timestamp,
        environmentDomain: environment.environmentDomain,
      }
      const updated = validateCandidate(model, candidate)

      assertChildMetadata(model, candidate, updated)
      assertChildValues(model, updated, environment.environmentDomain, InputValidationError)
      data = updated

      return updated
    }
    const result = await this.backend.update(resourceName(model), key, modify)

    if (!result) throw new RecordNotFoundError()
    if (!data) throw new HedraError('Backend did not apply the resource update')

    return { data, links: { self: resourceLink(context, key) } }
  }

  /** Deletes one resource. */
  async delete(context: Context, model: z.ZodObject, id: string): Promise<void> {
    const target = childTarget(context)

    if (target) {
      await mutateChildren(this.backend, context, model, target, 'delete')

      return
    }
    const key = parseInput(ResourceId, id)

    const { environment } = requireRequestScope(context)

    await this.backend.transaction((transaction) => {
      assertResource(transaction, { collection: resourceName(model), id: key }, environment.environmentDomain)
      assertUnassociated(transaction, { collection: resourceName(model), id: key }, environment.environmentDomain)
      if (!transaction.delete(resourceName(model), key)) throw new RecordNotFoundError()
    })
  }
}
