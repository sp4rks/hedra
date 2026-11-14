import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

import type { Collection } from '#models/collection.ts'
import { assertSafeKeys, jsonString } from '#controllers/validation.ts'
import { DatabaseScalar } from '#datastores/backend.ts'
import {
  BadRequestError,
  ConfigurationError,
  HedraError,
  InputValidationError,
  OutputValidationError,
  UnsupportedMediaTypeError,
} from '#errors'
import { ResourceId } from '#models/resource.ts'
import { ErrorResponse, JsonApiListResponse, JsonApiResponse } from '#models/rest.ts'
import { setResourceScope } from '#models/scope.ts'
import { project } from '#routes/projection.ts'

export type RouteValidators = {
  create?: z.ZodObject
  update?: z.ZodObject
  output?: z.ZodObject
}

const writeResponseFailure = 'Transaction succeeded, but response validation failed.'

/** Marks web response failures whose safe write-outcome detail may be returned. */
class ResponseValidationError extends OutputValidationError {}

/** Validates web configuration before registration can bind controllers or open a backend. */
export function assertRouteValidators(validators: RouteValidators): void {
  const parsed = z
    .strictObject({
      create: z.instanceof(z.ZodObject).optional(),
      update: z.instanceof(z.ZodObject).optional(),
      output: z.instanceof(z.ZodObject).optional(),
    })
    .safeParse(validators)

  if (!parsed.success) throw new ConfigurationError('configuration error', parsed.error.issues)
}

/** Validates a controller envelope and projects each resource before transport. */
function response(
  output: z.ZodObject,
  value: unknown,
  options: { list?: boolean; writeSucceeded?: boolean; id?: string } = {},
) {
  try {
    const json: unknown = JSON.parse(jsonString(value, OutputValidationError))
    const parsed = (options.list ? JsonApiListResponse : JsonApiResponse).safeParse(json)

    if (!parsed.success) throw new OutputValidationError()
    const envelope = parsed.data
    const data = Array.isArray(envelope.data)
      ? envelope.data.map((item) => project(output, item))
      : project(output, envelope.data)

    if (options.id !== undefined && !Array.isArray(envelope.data) && envelope.data.id !== options.id)
      throw new OutputValidationError()

    return { data, links: envelope.links }
  } catch {
    throw new ResponseValidationError(
      'output validation error',
      options.writeSucceeded ? writeResponseFailure : undefined,
    )
  }
}

/** Converts an input validation failure into the public client error. */
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)

  if (!result.success) throw new InputValidationError('input validation error', result.error.issues)

  return result.data
}

/** Reads JSON and applies the operation-specific model validator. */
async function body(context: Context, schema: z.ZodObject, partial: boolean): Promise<Record<string, unknown>> {
  const contentType = context.req.header('content-type')?.split(';')[0]?.trim().toLowerCase()

  if (!contentType || !/^application\/(?:json|[\w.+-]+\+json)$/.test(contentType)) {
    throw new UnsupportedMediaTypeError('unsupported content type')
  }
  let value: unknown

  try {
    value = await context.req.json()
  } catch {
    throw new BadRequestError()
  }
  assertSafeKeys(value)
  const object = input(z.record(z.string(), z.unknown()), value)
  const attributes = Object.fromEntries(
    Object.entries(object).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key)),
  )

  const parsed = input(schema, attributes)

  return partial ? Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(attributes, key))) : parsed
}

/** Validates the optional typed scalar equality filter. */
function query(
  context: Context,
  model: z.ZodObject,
  output: z.ZodObject,
): { filter?: Record<string, z.infer<typeof DatabaseScalar>> } {
  const params = new URL(context.req.url).searchParams

  if ([...params.keys()].some((key) => key !== 'filter') || params.getAll('filter').length > 1) {
    throw new InputValidationError()
  }
  const raw = params.get('filter')

  if (raw === null) return {}
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InputValidationError()
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new InputValidationError()
  const entries = Object.entries(parsed).map(([key, value]) => {
    const field = model.shape[key]

    if (!Object.hasOwn(model.shape, key) || !field || !Object.hasOwn(output.shape, key))
      throw new InputValidationError()

    return [key, input(DatabaseScalar, input(field, input(DatabaseScalar, value)))] as const
  })

  return { filter: Object.fromEntries(entries) }
}

/** Shapes errors raised by generated routes without affecting custom Hono routes. */
function handler(action: (context: Context) => Promise<Response>): (context: Context) => Promise<Response> {
  return async (context) => {
    try {
      return await action(context)
    } catch (error) {
      const known = error instanceof HedraError && error.status >= 400 && error.status < 500
      const status = known ? error.status : 500
      const title = known ? error.title : 'internal server error'
      const detail = known ? error.detail : error instanceof ResponseValidationError ? error.detail : undefined

      const response = ErrorResponse.safeParse({
        errors: [{ status, title, ...(detail === undefined ? {} : { detail }) }],
      })

      if (!response.success) return context.json({ errors: [{ status: 500, title: 'internal server error' }] }, 500)

      return context.json(response.data, status as ContentfulStatusCode)
    }
  }
}

/** Registers generated REST routes for one collection. */
export function registerRoutes(
  app: Hono,
  collection: Collection,
  validators: RouteValidators = {},
  before?: (context: Context) => void,
): void {
  const path = collection.endpoint
  const model = collection.model
  const mask = Object.fromEntries(
    ['id', 'createdAt', 'updatedAt'].filter((key) => Object.hasOwn(model.shape, key)).map((key) => [key, true]),
  )
  const attributes = model.clone({ ...model.def, checks: [] } as never).omit(mask as never)
  const createInput = validators.create ?? attributes
  const updateInput = validators.update ?? attributes.partial()
  const output =
    validators.output ?? z.object(Object.fromEntries(Object.entries(model.shape).filter(([key]) => key !== 'password')))

  app.get(
    path,
    handler(async (context) => {
      before?.(context)
      setResourceScope(context, { collection: collection.name, target: { kind: 'collection' } })

      const result = await collection.controller.list(
        context,
        collection,
        context.req.url,
        query(context, model, output),
      )

      return context.json(response(output, result, { list: true }))
    }),
  )
  app.post(
    path,
    handler(async (context) => {
      before?.(context)
      setResourceScope(context, { collection: collection.name, target: { kind: 'collection' } })
      const value = await body(context, createInput, false)
      const result = await collection.controller.create(context, collection, value as never)
      const projected = response(output, result, { writeSucceeded: true })

      context.header('Location', projected.links.self)

      return context.json(projected, 201)
    }),
  )
  app.get(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      setResourceScope(context, { collection: collection.name, target: { kind: 'resource', id } })

      const result = await collection.controller.id(context, collection, id)

      return context.json(response(output, result, { id }))
    }),
  )
  app.patch(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      setResourceScope(context, { collection: collection.name, target: { kind: 'resource', id } })
      const value = await body(context, updateInput, true)

      const result = await collection.controller.update(context, collection, value as never, id)

      return context.json(response(output, result, { writeSucceeded: true, id }))
    }),
  )
  app.delete(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      setResourceScope(context, { collection: collection.name, target: { kind: 'resource', id } })

      await collection.controller.delete(context, collection, id)

      return context.body(null, 204)
    }),
  )
}
