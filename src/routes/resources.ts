import type { Context, Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

import type { AssociationOperations } from '#controllers/associations.ts'
import type { Collection } from '#models/collection.ts'
import type { EmbeddedField } from '#models/embedded.ts'
import { DatabaseScalar } from '#datastores/backend.ts'
import {
  BadRequestError,
  ConfigurationError,
  HedraError,
  InputValidationError,
  UnsupportedMediaTypeError,
} from '#errors'
import { embeddedFields, inputModel, publicItem } from '#models/embedded.ts'
import { ResourceId } from '#models/resource.ts'
import { ErrorResponse } from '#models/rest.ts'
import { setAssociationScope, setEmbeddedScope } from '#models/scope.ts'

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
  const object = input(z.record(z.string(), z.unknown()), value)
  const attributes = Object.fromEntries(
    Object.entries(object).filter(([key]) => !['id', 'createdAt', 'updatedAt'].includes(key)),
  )

  checkDictionaryKeys(model, attributes)
  const schema = inputModel(model, partial)
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

type RouteStep = { field: EmbeddedField; parameter?: string }
type AssociationStep = { collection: Collection; parameter: string }

/** Validates a dictionary key against both its model and URL requirements. */
function dictionaryKey(field: EmbeddedField, value: unknown): string {
  const key = input(field.key ?? z.string(), value)

  if (typeof key !== 'string' || !key || ['.', '..', '__proto__'].includes(key)) throw new InputValidationError()

  return key
}

/** Rejects unsafe or unaddressable keys before model parsing can discard them. */
function checkDictionaryKeys(model: z.ZodObject, attributes: Record<string, unknown>): void {
  for (const field of embeddedFields(model)) {
    const value = attributes[field.name]

    if (value === null || typeof value !== 'object') continue
    if (field.kind === 'array' && Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          checkDictionaryKeys(field.model, item as Record<string, unknown>)
        }
      }
    } else if (field.kind === 'dictionary' && !Array.isArray(value)) {
      for (const [key, item] of Object.entries(value)) {
        dictionaryKey(field, key)
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          checkDictionaryKeys(field.model, item as Record<string, unknown>)
        }
      }
    } else if (field.kind === 'single' && !Array.isArray(value)) {
      checkDictionaryKeys(field.model, value as Record<string, unknown>)
    }
  }
}

/**
 * Validates embedded route names and output definitions before attaching a collection.
 * Each branch tracks its own ancestors, allowing sibling schema reuse while rejecting
 * cycles along a single path.
 */
export function checkRoutes(model: z.ZodObject, output: z.ZodObject, ancestors = new Set<z.ZodObject>()): void {
  if (ancestors.has(model)) throw new ConfigurationError('Recursive embedded routes are not supported')
  const branchAncestors = new Set(ancestors).add(model)

  for (const field of embeddedFields(model)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(field.name))
      throw new ConfigurationError(`Invalid embedded route name: ${field.name}`)
    const outputModel = publicItem(field, output)

    if (outputModel) checkRoutes(field.model, outputModel, branchAncestors)
  }
}

/** Installs parsed root and embedded selectors into the request context. */
function scope(
  context: Context,
  steps: RouteStep[],
  dictionarySelector?: string,
  rootParameter = 'r0',
  associations: AssociationStep[] = [],
): void {
  const rootId = input(ResourceId, context.req.param(rootParameter))
  const values = steps.map(({ field, parameter }, index) => {
    const raw = parameter ? context.req.param(parameter) : index === steps.length - 1 ? dictionarySelector : undefined
    const selector =
      raw === undefined ? undefined : field.kind === 'array' ? input(ResourceId, raw) : dictionaryKey(field, raw)

    return { field, ...(selector === undefined ? {} : { selector }) }
  })

  setEmbeddedScope(context, { rootId, steps: values })
  if (associations.length) associationScope(context, associations)
}

/** Installs validated independent-resource ancestors for association traversal. */
function associationScope(context: Context, steps: AssociationStep[]): void {
  setAssociationScope(
    context,
    steps.map(({ collection, parameter }) => ({
      collection: collection.name,
      id: input(ResourceId, context.req.param(parameter)),
    })),
  )
}

/** Registers nested routes using only declaration metadata and controller dispatch. */
function registerEmbedded(
  app: Hono,
  collection: Collection,
  path: string,
  model: z.ZodObject,
  output: z.ZodObject,
  parents: RouteStep[],
  rootParameter = 'r0',
  associations: AssociationStep[] = [],
): void {
  for (const field of embeddedFields(model)) {
    const visible = publicItem(field, output)

    if (!visible) continue
    const targetPath = `${path}/${field.name}`
    const parentSteps = [...parents, { field }]
    const parameter = `r${parents.length + 1}`
    const itemPath = field.kind === 'single' ? targetPath : `${targetPath}/:${parameter}`
    const itemSteps = [...parents, { field, ...(field.kind === 'single' ? {} : { parameter }) }]

    if (field.kind !== 'single') {
      app.get(
        targetPath,
        handler(async (context) => {
          scope(context, parentSteps, undefined, rootParameter, associations)

          return context.json(
            await collection.controller.list(
              context,
              collection,
              context.req.url,
              query(context, field.model, visible),
            ),
          )
        }),
      )
    }
    app.post(
      targetPath,
      handler(async (context) => {
        const params = new URL(context.req.url).searchParams
        let key: string | undefined

        if (field.kind === 'dictionary') {
          if ([...params.keys()].some((name) => name !== 'key') || params.getAll('key').length !== 1)
            throw new InputValidationError()
          key = dictionaryKey(field, params.get('key'))
        } else if ([...params.keys()].length) throw new InputValidationError()
        scope(context, parentSteps, key, rootParameter, associations)
        const value = await body(context, field.model, false)
        const response = await collection.controller.create(context, collection, value as never)

        context.header('Location', response.links.self)

        return context.json(response, 201)
      }),
    )
    app.get(
      itemPath,
      handler(async (context) => {
        scope(context, itemSteps, undefined, rootParameter, associations)

        return context.json(
          await collection.controller.id(
            context,
            collection,
            field.kind === 'single' ? field.name : (context.req.param(parameter) ?? ''),
          ),
        )
      }),
    )
    app.patch(
      itemPath,
      handler(async (context) => {
        scope(context, itemSteps, undefined, rootParameter, associations)
        const value = await body(context, field.model, true)

        return context.json(
          await collection.controller.update(
            context,
            collection,
            value as never,
            field.kind === 'single' ? field.name : (context.req.param(parameter) ?? ''),
          ),
        )
      }),
    )
    app.delete(
      itemPath,
      handler(async (context) => {
        scope(context, itemSteps, undefined, rootParameter, associations)
        await collection.controller.delete(
          context,
          collection,
          field.kind === 'single' ? field.name : (context.req.param(parameter) ?? ''),
        )

        return context.body(null, 204)
      }),
    )
    registerEmbedded(app, collection, itemPath, field.model, visible, itemSteps, rootParameter, associations)
  }
}

/** Registers nested traversal and unlink routes for declared associations. */
export function registerAssociationRoutes(
  app: Hono,
  source: Collection,
  operations: AssociationOperations,
  path = `${source.endpoint}/:a0`,
  ancestors: AssociationStep[] = [{ collection: source, parameter: 'a0' }],
): void {
  for (const target of source.associations) {
    const collectionPath = `${path}/${target.name}`
    const parameter = `a${ancestors.length}`
    const itemPath = `${collectionPath}/:${parameter}`
    const targetAncestors = [...ancestors, { collection: target, parameter }]

    app.get(
      collectionPath,
      handler(async (context) => {
        associationScope(context, ancestors)

        return context.json(
          await target.controller.list(
            context,
            target,
            context.req.url,
            query(context, target.model, target.outputValidator),
          ),
        )
      }),
    )
    app.post(
      collectionPath,
      handler(async (context) => {
        associationScope(context, ancestors)
        const value = await body(context, target.model, false)
        const response = await target.controller.create(context, target, value as never)

        context.header('Location', response.links.self)

        return context.json(response, 201)
      }),
    )
    app.get(
      itemPath,
      handler(async (context) => {
        associationScope(context, ancestors)
        const id = input(ResourceId, context.req.param(parameter))

        return context.json(await target.controller.id(context, target, id))
      }),
    )
    app.patch(
      itemPath,
      handler(async (context) => {
        associationScope(context, ancestors)
        const id = input(ResourceId, context.req.param(parameter))
        const value = await body(context, target.model, true)

        return context.json(await target.controller.update(context, target, value as never, id))
      }),
    )
    app.delete(
      itemPath,
      handler(async (context) => {
        associationScope(context, ancestors)
        const id = input(ResourceId, context.req.param(parameter))

        await target.controller.delete(context, target, id)

        return context.body(null, 204)
      }),
    )
    app.delete(
      `${path}/associations/${target.name}/:${parameter}`,
      handler(async (context) => {
        associationScope(context, ancestors.slice(0, -1))
        const sourceStep = ancestors.at(-1)

        if (!sourceStep) throw new HedraError('Missing association source')
        const from = { collection: source.name, id: input(ResourceId, context.req.param(sourceStep.parameter)) }
        const to = { collection: target.name, id: input(ResourceId, context.req.param(parameter)) }

        await operations.unlinkFrom(context, from, to)

        return context.body(null, 204)
      }),
    )
    registerEmbedded(app, target, itemPath, target.model, target.outputValidator, [], parameter, ancestors)
    registerAssociationRoutes(app, target, operations, itemPath, targetAncestors)
  }
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

      return context.json(await collection.controller.id(context, collection, id))
    }),
  )
  app.patch(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))
      const value = await body(context, collection.model, true)

      return context.json(await collection.controller.update(context, collection, value as never, id))
    }),
  )
  app.delete(
    `${path}/:id`,
    handler(async (context) => {
      before?.(context)
      const id = input(ResourceId, context.req.param('id'))

      await collection.controller.delete(context, collection, id)

      return context.body(null, 204)
    }),
  )
  registerEmbedded(app, collection, `${path}/:r0`, collection.model, collection.outputValidator, [])
}
