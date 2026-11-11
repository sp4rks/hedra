import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

import type { Collection } from '#models/collection.ts'
import { assertSafeKeys } from '#controllers/validation.ts'
import { DatabaseScalar } from '#datastores/backend.ts'
import { BadRequestError, HedraError, InputValidationError, UnsupportedMediaTypeError } from '#errors'
import { ResourceId } from '#models/resource.ts'
import { ErrorResponse } from '#models/rest.ts'
import { setResourceScope } from '#models/scope.ts'

/** Converts an input validation failure into the public client error. */
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)

  if (!result.success) throw new InputValidationError('input validation error', result.error.issues)

  return result.data
}

/** Reads JSON and applies the operation-specific model validator. */
async function body(context: Context, model: z.ZodObject, partial: boolean): Promise<Record<string, unknown>> {
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

  const mask = Object.fromEntries(
    ['id', 'createdAt', 'updatedAt'].filter((key) => Object.hasOwn(model.shape, key)).map((key) => [key, true]),
  )
  const inputSchema = model.clone({ ...model.def, checks: [] } as never).omit(mask as never)
  const schema = partial ? inputSchema.partial() : inputSchema
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
      const detail = known ? error.detail : undefined

      const response = ErrorResponse.safeParse({
        errors: [{ status, title, ...(detail === undefined ? {} : { detail }) }],
      })

      if (!response.success) return context.json({ errors: [{ status: 500, title: 'internal server error' }] }, 500)

      return context.json(response.data, status as ContentfulStatusCode)
    }
  }
}

/** Registers generated REST routes for one collection. */
export function registerRoutes(app: Hono, collection: Collection, before?: (context: Context) => void): void {
  const path = collection.endpoint

  app.get(
    path,
    handler(async (context) => {
      before?.(context)
      setResourceScope(context, { collection: collection.name, target: { kind: 'collection' } })

      return context.json(
        await collection.controller.list(
          context,
          collection,
          context.req.url,
          query(context, collection.model, collection.outputValidator),
        ),
      )
    }),
  )
  app.post(
    path,
    handler(async (context) => {
      before?.(context)
      setResourceScope(context, { collection: collection.name, target: { kind: 'collection' } })
      const value = await body(context, collection.model, false)
      const response = await collection.controller.create(context, collection, value as never)

      context.header('Location', response.links.self)

      return context.json(response, 201)
    }),
  )
  app.get(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      setResourceScope(context, { collection: collection.name, target: { kind: 'resource', id } })

      return context.json(await collection.controller.id(context, collection, id))
    }),
  )
  app.patch(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      setResourceScope(context, { collection: collection.name, target: { kind: 'resource', id } })
      const value = await body(context, collection.model, true)

      return context.json(await collection.controller.update(context, collection, value as never, id))
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
