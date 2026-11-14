import type { Context } from 'hono'
import { z } from 'zod'

import type { Config } from '#config'
import type { ControllerInterface } from '#controllers/controller.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import type { Collection } from '#models/collection.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { resourceLink } from '#controllers/controller.ts'
import {
  InputValidationError,
  OutputValidationError,
  PreconditionFailedError,
  parseInput,
  RecordNotFoundError,
} from '#errors'
import { requestHostname } from '#middleware/request-scope.ts'
import { ResourceId } from '#models/resource.ts'
import { QueryParams as QuerySchema } from '#models/rest.ts'
import { Tenant, TenantChanges, TenantInput } from '#models/tenant.ts'

export class TenantController implements ControllerInterface {
  /** Uses app configuration and obtains its configuration datastore on demand. */
  constructor(
    private readonly config: Config,
    private readonly datastore: () => ConfigDatastore,
  ) {}

  /** Removes server-owned attributes before validating tenant input. */
  private attributes(input: ResourceInput): Record<string, unknown> {
    const value = parseInput(z.record(z.string(), z.unknown()), input)

    delete value.id
    delete value.createdAt
    delete value.updatedAt

    return value
  }

  /** Validates a tenant returned by a configuration datastore. */
  private tenantOutput(input: unknown, id?: string): Tenant {
    const parsed = Tenant.safeParse(input)

    if (!parsed.success) throw new OutputValidationError('output validation error', parsed.error.issues)

    const tenant = parsed.data

    if (id !== undefined && tenant.id !== id) throw new OutputValidationError('Resource ID cannot change')

    return tenant
  }

  /** Requires requests to use the deployment API host. */
  assertHost(context: Context): void {
    if (requestHostname(context) !== this.config.deploymentApiDomain.toLowerCase()) {
      throw new PreconditionFailedError('precondition failed', 'Tenant operations require the deployment API host.')
    }
  }

  /** Creates a tenant in the configuration catalogue. */
  async create(context: Context, _collection: Collection, input: ResourceInput): Promise<JsonApiResponse> {
    this.assertHost(context)
    const fields = this.attributes(input)
    const tenantDomain = parseInput(Tenant.shape.tenantDomain, fields.tenantDomain)

    const suffix = `.${this.config.deploymentDomain.toLowerCase()}`
    const label = tenantDomain.endsWith(suffix) ? tenantDomain.slice(0, -suffix.length) : ''

    fields.tenantDomain = tenantDomain

    if (
      !label ||
      label.includes('.') ||
      [this.config.deploymentApiDomain.toLowerCase(), this.config.deploymentDocsDomain.toLowerCase()].includes(
        tenantDomain,
      )
    ) {
      throw new InputValidationError('Tenant domain must be a direct subdomain of the deployment domain')
    }
    const tenant = this.tenantOutput(await this.datastore().tenants.create(parseInput(TenantInput, fields)))

    if (tenant.tenantDomain !== tenantDomain) throw new OutputValidationError('Tenant domain cannot change')

    return { data: tenant, links: { self: resourceLink(context, tenant.id) } }
  }

  /** Returns one tenant. */
  async id(context: Context, _collection: Collection, id: string): Promise<JsonApiResponse> {
    this.assertHost(context)
    const key = parseInput(ResourceId, id)
    const value = await this.datastore().tenants.get(key)

    if (value === null) throw new RecordNotFoundError()
    const tenant = this.tenantOutput(value, key)

    return { data: tenant, links: { self: resourceLink(context, key) } }
  }

  /** Returns tenants matching domain scalar fields. */
  async list(
    context: Context,
    _collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    this.assertHost(context)
    const options = parseInput(QuerySchema, queryParams === undefined ? {} : queryParams)
    const filter: Record<string, string> = {}

    for (const [key, value] of Object.entries(options.filter ?? {})) {
      const schema = Tenant.shape[key as keyof typeof Tenant.shape]

      if (!Object.hasOwn(Tenant.shape, key) || !schema) throw new InputValidationError()
      filter[key] = parseInput(schema, value)
    }
    const values = await this.datastore().tenants.list(filter)

    const url = z.url().safeParse(baseUrl)

    if (!url.success) throw new OutputValidationError('output validation error', url.error.issues)

    return {
      data: values.map((value) => this.tenantOutput(value)),
      links: { self: url.data },
    }
  }

  /** Changes a tenant name without allowing its domain to change. */
  async update(context: Context, _collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    this.assertHost(context)
    const key = parseInput(ResourceId, id)
    const fields = this.attributes(input)

    if (Object.hasOwn(fields, 'tenantDomain')) throw new InputValidationError('Tenant domain cannot change')
    const value = await this.datastore().tenants.update(key, parseInput(TenantChanges, fields))

    if (value === null) throw new RecordNotFoundError()
    const tenant = this.tenantOutput(value, key)

    return { data: tenant, links: { self: resourceLink(context, key) } }
  }

  /** Deletes one tenant. */
  async delete(context: Context, _collection: Collection, id: string): Promise<void> {
    this.assertHost(context)
    const key = parseInput(ResourceId, id)

    if (!(await this.datastore().tenants.delete(key))) throw new RecordNotFoundError()
  }
}
