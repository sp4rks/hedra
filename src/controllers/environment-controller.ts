import type { Context } from 'hono'
import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import type { Collection } from '#models/collection.ts'
import type { EnvironmentInput } from '#models/environment.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { resourceLink } from '#controllers/controller.ts'
import { InputValidationError, OutputValidationError, parseInput, RecordNotFoundError } from '#errors'
import { isDirectDomain } from '#models/domain.ts'
import {
  EnvironmentChanges as ChangesSchema,
  Environment,
  EnvironmentInput as InputSchema,
} from '#models/environment.ts'
import { ResourceId } from '#models/metadata.ts'
import { requireTenantScope } from '#models/request-scope.ts'
import { QueryParams as QuerySchema } from '#models/rest.ts'

export class EnvironmentController implements ControllerInterface {
  /** Obtains configuration operations only after request middleware resolved a tenant. */
  constructor(private readonly datastore: () => ConfigDatastore) {}

  /** Removes generated identity fields while refusing externally supplied tenant ownership. */
  private attributes(input: ResourceInput): Record<string, unknown> {
    const fields = parseInput(z.record(z.string(), z.unknown()), input)

    if (Object.hasOwn(fields, 'tenantDomain'))
      throw new InputValidationError('Tenant ownership is managed by the server')
    delete fields.id
    delete fields.createdAt
    delete fields.updatedAt

    return fields
  }

  /** Validates complete environment output and its resolved tenant relationship. */
  private output(context: Context, input: unknown, id?: string): Environment {
    const tenant = requireTenantScope(context)
    const parsed = Environment.safeParse(input)

    if (!parsed.success) throw new OutputValidationError('output validation error', parsed.error.issues)
    const environment = parsed.data

    if (
      (id !== undefined && environment.id !== id) ||
      environment.tenantDomain !== tenant.tenantDomain ||
      !isDirectDomain(environment.environmentDomain, tenant.tenantDomain)
    )
      throw new OutputValidationError('Environment ownership cannot change')

    return environment
  }

  /** Creates an environment beneath the request tenant. */
  async create(context: Context, _collection: Collection, input: ResourceInput): Promise<JsonApiResponse> {
    const tenant = requireTenantScope(context)
    const fields = parseInput(InputSchema, this.attributes(input))

    if (!isDirectDomain(fields.environmentDomain, tenant.tenantDomain))
      throw new InputValidationError('Environment domain must be a direct subdomain of its tenant')
    const value = await this.datastore().environments.create(tenant.tenantDomain, fields as EnvironmentInput)
    const data = this.output(context, value)

    if (data.environmentDomain !== parseInput(Environment.shape.environmentDomain, fields.environmentDomain))
      throw new OutputValidationError('Environment domain cannot change')

    return { data, links: { self: resourceLink(context, data.id) } }
  }

  /** Returns an environment in the request tenant. */
  async id(context: Context, _collection: Collection, id: string): Promise<JsonApiResponse> {
    const tenant = requireTenantScope(context)
    const key = parseInput(ResourceId, id)
    const value = await this.datastore().environments.get(tenant.tenantDomain, key)

    if (value === null) throw new RecordNotFoundError()

    return { data: this.output(context, value, key), links: { self: resourceLink(context, key) } }
  }

  /** Lists environments with compulsory tenant ownership. */
  async list(
    context: Context,
    _collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    const tenant = requireTenantScope(context)
    const query = parseInput(QuerySchema, queryParams ?? {})
    const filter = parseInput(Environment.omit({ tenantDomain: true }).partial(), query.filter ?? {})
    const values = await this.datastore().environments.list(tenant.tenantDomain, filter)
    const url = z.url().safeParse(baseUrl)

    if (!url.success) throw new OutputValidationError('output validation error', url.error.issues)

    return { data: values.map((value) => this.output(context, value)), links: { self: url.data } }
  }

  /** Changes an environment name through tenant-scoped configuration operations. */
  async update(context: Context, _collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    const tenant = requireTenantScope(context)
    const key = parseInput(ResourceId, id)
    const value = await this.datastore().environments.update(
      tenant.tenantDomain,
      key,
      parseInput(ChangesSchema, this.attributes(input)),
    )

    if (value === null) throw new RecordNotFoundError()

    return { data: this.output(context, value, key), links: { self: resourceLink(context, key) } }
  }

  /** Hides an environment while retaining its permanent domain reservation. */
  async delete(context: Context, _collection: Collection, id: string): Promise<void> {
    const tenant = requireTenantScope(context)
    const key = parseInput(ResourceId, id)

    if (!(await this.datastore().environments.delete(tenant.tenantDomain, key))) throw new RecordNotFoundError()
  }
}
