import type { Context } from 'hono'
import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import { assertSafeKeys } from '#controllers/validation.ts'
import { DatabaseScalar } from '#datastores/backend.ts'
import { BadRequestError, ConfigurationError, InputValidationError, UnsupportedMediaTypeError } from '#errors'
import { assertChildOwnership, childInput } from '#models/children.ts'
import { Domain } from '#models/domain.ts'
import { ResourceId, resourceName } from '#models/resource.ts'
import { setResourceScope } from '#models/scope.ts'
import { response, routeHandler } from '#web/responses.ts'

export type RouteValidators = {
  create?: z.ZodObject
  update?: z.ZodObject
  output?: z.ZodObject
}

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

/** Converts an input validation failure into the public client error. */
export function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)

  if (!result.success) throw new InputValidationError('input validation error', result.error.issues)

  return result.data
}

/** Reads JSON and applies the operation-specific model validator. */
export async function body(
  context: Context,
  schema: z.ZodObject,
  submittedOnly: boolean,
  ownership: string | null,
  model?: z.ZodObject,
): Promise<Record<string, unknown>> {
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

  if (ownership !== null && Object.hasOwn(object, ownership))
    throw new InputValidationError('Ownership is managed by the server')
  if (model) assertChildOwnership(model, object)
  const attributes = Object.fromEntries(
    Object.entries(object).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key)),
  )

  const parsed = input(schema, attributes)

  return submittedOnly
    ? Object.fromEntries(Object.entries(parsed).filter(([key]) => Object.hasOwn(attributes, key)))
    : parsed
}

/** Validates the optional typed scalar equality filter. */
function query(
  context: Context,
  model: z.ZodObject,
  output: z.ZodObject,
  ownership: string | null,
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
    if (key === ownership) throw new InputValidationError('Ownership filters are managed by the server')
    const field = model.shape[key]

    if (!Object.hasOwn(model.shape, key) || !field || !Object.hasOwn(output.shape, key))
      throw new InputValidationError()

    return [key, input(DatabaseScalar, input(field, input(DatabaseScalar, value)))] as const
  })

  return { filter: Object.fromEntries(entries) }
}

/** Builds the actual CRUD handlers and their request validators for one stored model. */
export function resourceHandlers(
  model: z.ZodObject,
  controller: ControllerInterface,
  validators: RouteValidators = {},
  ownership: 'environmentDomain' | 'tenantDomain' | null = 'environmentDomain',
  identity: 'id' | 'tenantDomain' | 'environmentDomain' = 'id',
) {
  const name = resourceName(model)
  const mask = Object.fromEntries(
    ['id', 'createdAt', 'updatedAt', ...(ownership === null ? [] : [ownership])]
      .filter((key) => Object.hasOwn(model.shape, key))
      .map((key) => [key, true]),
  )
  const attributes = model.clone({ ...model.def, checks: [] } as never).omit(mask as never)
  const createInput = validators.create ?? (ownership === 'environmentDomain' ? childInput(model, false) : attributes)
  const updateInput =
    validators.update ?? (ownership === 'environmentDomain' ? childInput(model, true) : attributes.partial())
  const updateSubmittedOnly = validators.update === undefined
  const output =
    validators.output ?? z.object(Object.fromEntries(Object.entries(model.shape).filter(([key]) => key !== 'password')))

  return {
    identity,
    output,
    list: routeHandler(async (context) => {
      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'collection' } })

      const result = await controller.list(context, model, context.req.url, query(context, model, output, ownership))

      return context.json(response(output, result, { list: true, model }))
    }),
    create: routeHandler(async (context) => {
      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'collection' } })
      const value = await body(context, createInput, false, ownership, model)
      const result = await controller.create(context, model, value as never)
      const validated = response(output, result, { writeSucceeded: true, model })

      context.header('Location', validated.links.self)

      return context.json(validated, 201)
    }),
    id: routeHandler(async (context) => {
      const id = input(identity === 'id' ? ResourceId : Domain, context.req.param(identity))

      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'resource', id } })

      const result = await controller.id(context, model, id)

      return context.json(
        response(output, result, {
          ...(identity === 'id' ? { id } : { domain: { field: identity, value: id } }),
          model,
        }),
      )
    }),
    update: routeHandler(async (context) => {
      const id = input(identity === 'id' ? ResourceId : Domain, context.req.param(identity))

      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'resource', id } })
      const value = await body(context, updateInput, updateSubmittedOnly, ownership, model)

      const result = await controller.update(context, model, value as never, id)

      return context.json(
        response(output, result, {
          writeSucceeded: true,
          ...(identity === 'id' ? { id } : { domain: { field: identity, value: id } }),
          model,
        }),
      )
    }),
    delete: routeHandler(async (context) => {
      const id = input(identity === 'id' ? ResourceId : Domain, context.req.param(identity))

      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'resource', id } })

      await controller.delete(context, model, id)

      return context.body(null, 204)
    }),
  }
}
