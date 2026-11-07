import type { Context } from 'hono'
import { z } from 'zod'

import type { Config } from '#config'
import type { ControllerInterface } from '#controllers/controller.ts'
import type { ConfigDatastore } from '#datastores/categories/config/config.ts'
import type { Collection } from '#models/collection.ts'
import type { JsonApiListResponse, JsonApiResponse, QueryParams, ResourceInput } from '#models/rest.ts'
import { resourceLink } from '#controllers/controller.ts'
import { project } from '#controllers/projection.ts'
import {
  hedraError,
  InputValidationError,
  OutputValidationError,
  PreconditionFailedError,
  parseInput,
  RecordNotFoundError,
} from '#errors'
import { ResourceId } from '#models/resource.ts'
import { QueryParams as QuerySchema } from '#models/rest.ts'
import { Tenant } from '#models/tenant.ts'

const TenantInput = Tenant.omit({ id: true, createdAt: true, updatedAt: true })
const TenantChanges = TenantInput.omit({ tenantDomain: true }).partial()

/** Removes server-owned attributes before validating tenant input. */
function attributes(input: ResourceInput): Record<string, unknown> {
  const value = parseInput(z.record(z.string(), z.unknown()), input)

  delete value.id
  delete value.createdAt
  delete value.updatedAt

  return value
}

/** Validates a tenant returned by a configuration datastore. */
function tenantOutput(input: unknown, id?: string): Tenant {
  try {
    const tenant = Tenant.parse(input)

    if (id !== undefined && tenant.id !== id) throw new OutputValidationError('Resource ID cannot change')

    return tenant
  } catch (error) {
    throw hedraError(error, OutputValidationError)
  }
}

export class TenantController implements ControllerInterface {
  /** Uses app configuration and obtains its configuration datastore on demand. */
  constructor(
    private readonly config: Config,
    private readonly datastore: () => ConfigDatastore,
  ) {}

  /** Requires requests to use the deployment API host. */
  assertHost(context: Context): void {
    try {
      const host = context.req.header('host')
      const match = host?.match(/^([a-z0-9.-]+)(?::([0-9]{1,5}))?$/i)

      if (
        !match ||
        match[1]?.toLowerCase() !== this.config.deploymentApiDomain.toLowerCase() ||
        (match[2] !== undefined && Number(match[2]) > 65535)
      ) {
        throw new PreconditionFailedError('precondition failed', 'Tenant operations require the deployment API host.')
      }
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Creates a tenant in the configuration catalogue. */
  async create(context: Context, collection: Collection, input: ResourceInput): Promise<JsonApiResponse> {
    try {
      this.assertHost(context)
      const fields = parseInput(TenantInput, attributes(input))
      const suffix = `.${this.config.deploymentDomain.toLowerCase()}`
      const label = fields.tenantDomain.endsWith(suffix) ? fields.tenantDomain.slice(0, -suffix.length) : ''

      if (
        !label ||
        label.includes('.') ||
        [this.config.deploymentApiDomain.toLowerCase(), this.config.deploymentDocsDomain.toLowerCase()].includes(
          fields.tenantDomain,
        )
      ) {
        throw new InputValidationError('Tenant domain must be a direct subdomain of the deployment domain')
      }
      const tenant = tenantOutput(await this.datastore().tenants.create(fields))

      if (tenant.tenantDomain !== fields.tenantDomain) throw new OutputValidationError('Tenant domain cannot change')

      return { data: project(collection, tenant), links: { self: resourceLink(context, tenant.id) } }
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Returns one tenant. */
  async id(context: Context, collection: Collection, id: string): Promise<JsonApiResponse> {
    try {
      this.assertHost(context)
      const key = parseInput(ResourceId, id)
      const value = await this.datastore().tenants.get(key)

      if (value === null) throw new RecordNotFoundError()
      const tenant = tenantOutput(value, key)

      return { data: project(collection, tenant), links: { self: resourceLink(context, key) } }
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Returns tenants matching public scalar fields. */
  async list(
    context: Context,
    collection: Collection,
    baseUrl: string,
    queryParams?: QueryParams,
  ): Promise<JsonApiListResponse> {
    try {
      this.assertHost(context)
      const options = parseInput(QuerySchema, queryParams ?? {})
      const filter: Record<string, string> = {}

      for (const [key, value] of Object.entries(options.filter ?? {})) {
        const schema = Tenant.shape[key as keyof typeof Tenant.shape]

        if (!schema || !Object.hasOwn(collection.outputValidator.shape, key)) throw new InputValidationError()
        filter[key] = parseInput(schema, value)
      }
      const values = await this.datastore().tenants.list(filter)

      return {
        data: values.map((value) => project(collection, tenantOutput(value))),
        links: { self: z.url().parse(baseUrl) },
      }
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Changes a tenant name without allowing its domain to change. */
  async update(context: Context, collection: Collection, input: ResourceInput, id: string): Promise<JsonApiResponse> {
    try {
      this.assertHost(context)
      const key = parseInput(ResourceId, id)
      const fields = parseInput(TenantChanges, attributes(input))
      const value = await this.datastore().tenants.update(key, fields)

      if (value === null) throw new RecordNotFoundError()
      const tenant = tenantOutput(value, key)

      return { data: project(collection, tenant), links: { self: resourceLink(context, key) } }
    } catch (error) {
      throw hedraError(error)
    }
  }

  /** Deletes one tenant. */
  async delete(context: Context, _collection: Collection, id: string): Promise<void> {
    try {
      this.assertHost(context)
      const key = parseInput(ResourceId, id)

      if (!(await this.datastore().tenants.delete(key))) throw new RecordNotFoundError()
    } catch (error) {
      throw hedraError(error)
    }
  }
}
