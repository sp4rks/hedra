import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

import type { ChildTarget } from '#controllers/children.ts'
import type { ControllerInterface } from '#controllers/controller.ts'
import type { ResourceInput } from '#models/rest.ts'
import { assertChildValues, childObject, childPlacement } from '#controllers/children.ts'
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
import { assertChildOwnership, childFields, childInput, safeChildKey } from '#models/children.ts'
import { Domain } from '#models/domain.ts'
import { ResourceId, resourceName } from '#models/resource.ts'
import { ErrorResponse, JsonApiListResponse, JsonApiResponse, ResourceInput as ResourceSchema } from '#models/rest.ts'
import { setResourceScope } from '#models/scope.ts'

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

/** Checks exposed identity claims against possible original parents at the same schema placement. */
function assertChildOutput(model: z.ZodObject, before: ResourceInput, after: ResourceInput): Set<ResourceInput> {
  const claims = new Set<ResourceInput>()

  /** Keeps each exposed original address unique throughout this projected subtree. */
  const retain = (values: Set<ResourceInput>): void => {
    for (const value of values) {
      if (claims.has(value)) throw new OutputValidationError('Duplicate child identity')
      claims.add(value)
    }
  }

  for (const field of childFields(model)) {
    const visible = after[field.name]
    const original = before[field.name]

    if (!visible || typeof visible !== 'object') continue
    if (field.kind === 'object') {
      if (!Array.isArray(visible))
        retain(
          assertChildOutput(
            field.model,
            original && typeof original === 'object' && !Array.isArray(original) ? (original as ResourceInput) : {},
            visible as ResourceInput,
          ),
        )
      continue
    }
    const entries =
      field.kind === 'array' && Array.isArray(visible)
        ? visible.map((value) => [undefined, value] as const)
        : field.kind === 'dictionary' && !Array.isArray(visible)
          ? Object.entries(visible)
          : field.kind === 'single' && !Array.isArray(visible)
            ? [[undefined, visible] as const]
            : []

    for (const [key, value] of entries) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const child = value as ResourceInput
      const originals =
        field.kind === 'array'
          ? Array.isArray(original)
            ? original
            : []
          : field.kind === 'dictionary'
            ? original &&
              typeof original === 'object' &&
              !Array.isArray(original) &&
              key !== undefined &&
              Object.hasOwn(original, key)
              ? [original[key]]
              : []
            : [original]
      const candidates = originals.filter(
        (item): item is ResourceInput => !!item && typeof item === 'object' && !Array.isArray(item),
      )
      const matches: Set<ResourceInput>[] = []

      // Hidden array-parent IDs carry no claim; descendants may still identify exactly one original parent.
      for (const candidate of candidates.length ? candidates : [{}]) {
        try {
          const exposesId = Object.hasOwn(child, 'id')

          if (exposesId && (typeof child.id !== 'string' || child.id !== candidate.id))
            throw new OutputValidationError('Output changed child identity')
          const descendants = assertChildOutput(field.model, candidate, child)

          if (exposesId) descendants.add(candidate)
          matches.push(descendants)
        } catch (error) {
          if (!(error instanceof OutputValidationError)) throw error
        }
      }
      const match = matches[0]

      if (!match || (matches.length > 1 && matches.some((candidate) => candidate.size > 0)))
        throw new OutputValidationError('Missing or ambiguous child identity')
      retain(match)
    }
  }

  return claims
}

/** Validates a controller envelope and its web output before transport. */
function response(
  output: z.ZodObject,
  value: unknown,
  options: {
    list?: boolean
    writeSucceeded?: boolean
    id?: string
    domain?: { field: 'tenantDomain' | 'environmentDomain'; value: string }
    model?: z.ZodObject
    child?: { model: z.ZodObject; target: ChildTarget; create?: boolean; url: string }
  } = {},
) {
  try {
    const json: unknown = JSON.parse(jsonString(value, OutputValidationError))
    const parsed = (options.list ? JsonApiListResponse : JsonApiResponse).safeParse(json)

    if (!parsed.success) throw new OutputValidationError()
    const envelope = parsed.data

    /** Applies the output schema while preserving JSON integrity and resource identity. */
    function validateOutput(record: ResourceInput): ResourceInput {
      const id = record.id
      const model = options.model ?? options.child?.model

      if (model)
        assertChildValues(
          model,
          record,
          typeof record.environmentDomain === 'string' ? record.environmentDomain : '',
          OutputValidationError,
        )
      const result = output.safeParse(structuredClone(record))

      if (!result.success) throw new OutputValidationError('output validation error', result.error.issues)
      const jsonOutput: unknown = JSON.parse(jsonString(result.data, OutputValidationError))
      const resource = ResourceSchema.safeParse(jsonOutput)

      if (!resource.success) throw new OutputValidationError('output validation error', resource.error.issues)
      if (Object.hasOwn(resource.data, 'id') && resource.data.id !== id)
        throw new OutputValidationError('Output changed resource identity')

      if (
        options.domain &&
        Object.hasOwn(resource.data, options.domain.field) &&
        resource.data[options.domain.field] !== record[options.domain.field]
      )
        throw new OutputValidationError('Output changed catalogue identity')
      if (model) assertChildOutput(model, record, jsonOutput as ResourceInput)

      // Preserve literal JSON property names that the resource parser may omit.
      return { ...resource.data, ...(jsonOutput as ResourceInput) }
    }

    if (options.child) {
      const { model, target, create, url } = options.child
      const original = Array.isArray(envelope.data)
        ? envelope.data.length === 1
          ? envelope.data[0]
          : undefined
        : envelope.data

      if (!original || original.id !== target.rootId) throw new OutputValidationError('Invalid containing root')
      const visible = validateOutput(original)
      const address = structuredClone(target)
      const last = address.steps.at(-1)

      if (!last) throw new OutputValidationError()
      if (create && last.selector.kind === 'array') {
        const self = new URL(envelope.links.self)
        const request = new URL(url)
        const prefix = `${request.pathname.replace(/\/+$/, '')}/`
        const id = self.pathname.slice(prefix.length)

        if (self.origin !== request.origin || !self.pathname.startsWith(prefix) || self.search || self.hash)
          throw new OutputValidationError('Invalid child self link')
        last.selector.id = ResourceId.parse(id)
      }
      const stored = childPlacement(original, model, address.steps)
      const projected = childPlacement(visible, model, address.steps)
      const raw = stored.value
      const exposed = projected.value

      if (raw === undefined || raw === null || exposed === undefined || exposed === null)
        throw new OutputValidationError('Hidden child placement')
      /** Checks visible child identity against this original placement, never another parent's data. */
      const selected = (before: unknown, after: unknown): ResourceInput => {
        const originalChild = childObject(before)
        const visibleChild = childObject(after)

        if (
          typeof originalChild.id !== 'string' ||
          (Object.hasOwn(visibleChild, 'id') && visibleChild.id !== originalChild.id)
        )
          throw new OutputValidationError('Output changed child identity')
        const parsed = ResourceSchema.safeParse(visibleChild)

        if (!parsed.success) throw new OutputValidationError()

        return { ...parsed.data, ...visibleChild } as ResourceInput
      }

      // Every managed ancestor must keep its identity at the original addressed placement.
      for (let index = 0; index < address.steps.length - 1; index++) {
        if (address.steps[index]?.selector.kind === 'object') continue
        const steps = address.steps.slice(0, index + 1)

        selected(childPlacement(original, model, steps).value, childPlacement(visible, model, steps).value)
      }

      if (last.selector.kind === 'array' && last.selector.id === undefined) {
        if (!Array.isArray(raw) || !Array.isArray(exposed)) throw new OutputValidationError()
        // The complete parent projection already validated every exposed ID; anonymous DTOs need no positional match.
        const data = exposed.map((item) => {
          const parsed = ResourceSchema.safeParse(item)

          if (!parsed.success) throw new OutputValidationError()

          return { ...parsed.data, ...childObject(item) } as ResourceInput
        })

        return { data, links: envelope.links }
      }
      if (last.selector.kind === 'dictionary' && last.selector.key === undefined) {
        const before = childObject(raw)
        const data = Object.fromEntries(
          Object.entries(childObject(exposed)).map(([key, item]) => [safeChildKey(key), selected(before[key], item)]),
        )
        const parsed = z.record(z.string(), ResourceSchema).safeParse(data)

        if (!parsed.success) throw new OutputValidationError()

        return { data: parsed.data, links: envelope.links }
      }

      return { data: selected(raw, exposed), links: envelope.links }
    }
    const data = Array.isArray(envelope.data) ? envelope.data.map(validateOutput) : validateOutput(envelope.data)

    if (options.id !== undefined && !Array.isArray(envelope.data) && envelope.data.id !== options.id)
      throw new OutputValidationError()

    if (options.domain && !Array.isArray(envelope.data) && envelope.data[options.domain.field] !== options.domain.value)
      throw new OutputValidationError('Output changed catalogue identity')

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
async function body(
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

/** Shapes errors raised by generated routes without affecting custom Hono routes. */
export function routeHandler(action: (context: Context) => Promise<Response>): (context: Context) => Promise<Response> {
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

/** Gives resolver failures the same error contract as generated route actions. */
export function guardedMiddleware(middleware: MiddlewareHandler): MiddlewareHandler {
  return (context, next) =>
    routeHandler(async () => {
      await middleware(context, next)

      return context.res
    })(context)
}

/** Registers generated REST routes for one collection. */
export function registerRoutes(
  app: Hono,
  model: z.ZodObject,
  controller: ControllerInterface,
  validators: RouteValidators = {},
  before?: MiddlewareHandler,
  ownership: 'environmentDomain' | 'tenantDomain' | null = 'environmentDomain',
  identity: 'id' | 'tenantDomain' | 'environmentDomain' = 'id',
): void {
  const name = resourceName(model)
  const path = `/${name}`
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

  const middleware: MiddlewareHandler = guardedMiddleware(
    before ??
      (async (_context, next) => {
        await next()
      }),
  )

  app.get(
    path,
    middleware,
    routeHandler(async (context) => {
      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'collection' } })

      const result = await controller.list(context, model, context.req.url, query(context, model, output, ownership))

      return context.json(response(output, result, { list: true, model }))
    }),
  )
  app.post(
    path,
    middleware,
    routeHandler(async (context) => {
      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'collection' } })
      const value = await body(context, createInput, false, ownership, model)
      const result = await controller.create(context, model, value as never)
      const validated = response(output, result, { writeSucceeded: true, model })

      context.header('Location', validated.links.self)

      return context.json(validated, 201)
    }),
  )
  app.get(
    `${path}/:${identity}`,
    middleware,
    routeHandler(async (context) => {
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
  )
  app.patch(
    `${path}/:${identity}`,
    middleware,
    routeHandler(async (context) => {
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
  )
  app.delete(
    `${path}/:${identity}`,
    middleware,
    routeHandler(async (context) => {
      const id = input(identity === 'id' ? ResourceId : Domain, context.req.param(identity))

      if (identity === 'id') setResourceScope(context, { collection: name, target: { kind: 'resource', id } })

      await controller.delete(context, model, id)

      return context.body(null, 204)
    }),
  )

  if (ownership === 'environmentDomain') registerChildRoutes(app, model, controller, output, middleware)
}

/** Registers finite child paths whose controllers always return containing-root snapshots. */
function registerChildRoutes(
  app: Hono,
  root: z.ZodObject,
  controller: ControllerInterface,
  output: z.ZodObject,
  middleware: MiddlewareHandler,
): void {
  type Address = { field: string; kind: 'array' | 'dictionary' | 'single' | 'object'; parameter?: string }
  const name = resourceName(root)
  /** Installs one nested operation using an explicit root UUID and ordered child selectors. */
  const mount = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    steps: Address[],
    model: z.ZodObject,
    list = false,
  ): void => {
    app[method](
      path,
      middleware,
      routeHandler(async (context) => {
        try {
          decodeURIComponent(new URL(context.req.url).pathname)
        } catch {
          throw new InputValidationError('Invalid child URI encoding')
        }
        const rootId = input(ResourceId, context.req.param('rootId'))
        const target: ChildTarget = {
          kind: 'child',
          rootId,
          steps: steps.map((step) => ({
            field: step.field,
            selector:
              step.kind === 'single' || step.kind === 'object'
                ? { kind: step.kind }
                : step.kind === 'array'
                  ? {
                      kind: 'array',
                      ...(step.parameter ? { id: input(ResourceId, context.req.param(step.parameter)) } : {}),
                    }
                  : {
                      kind: 'dictionary',
                      ...(step.parameter ? { key: safeChildKey(context.req.param(step.parameter) ?? '') } : {}),
                    },
          })),
        }

        setResourceScope(context, { collection: name, target })
        if (new URL(context.req.url).search) throw new InputValidationError('Child queries are not supported')
        if (method === 'delete') {
          const snapshot = await controller.id(context, root, rootId)

          response(output, snapshot, { child: { model: root, target, url: context.req.url } })
          await controller.delete(context, root, rootId)

          return context.body(null, 204)
        }
        let result: unknown

        if (method === 'get')
          result = list
            ? await controller.list(context, root, context.req.url)
            : await controller.id(context, root, rootId)
        else {
          const value = await body(
            context,
            childInput(model, method === 'patch'),
            method === 'patch',
            'environmentDomain',
            model,
          )

          result =
            method === 'post'
              ? await controller.create(context, root, value as never)
              : await controller.update(context, root, value as never, rootId)
        }
        const validated = response(output, result, {
          list,
          writeSucceeded: method !== 'get',
          child: { model: root, target, create: method === 'post', url: context.req.url },
        })

        if (method === 'post') context.header('Location', validated.links.self)

        return context.json(validated, method === 'post' ? 201 : 200)
      }),
    )
  }
  /** Walks only discovered managed placements; ordinary nested data gains no endpoints. */
  const walk = (model: z.ZodObject, prefix: string, ancestors: Address[]): void => {
    for (const field of childFields(model)) {
      const path = `${prefix}/${field.name}`

      if (field.kind === 'object') {
        walk(field.model, path, [...ancestors, { field: field.name, kind: 'object' }])
        continue
      }
      const parameter = `child${ancestors.length}`
      const collection = [...ancestors, { field: field.name, kind: field.kind }]
      const item = [
        ...ancestors,
        { field: field.name, kind: field.kind, ...(field.kind === 'single' ? {} : { parameter }) },
      ]
      const itemPath = field.kind === 'single' ? path : `${path}/:${parameter}`

      if (field.kind !== 'single') mount('get', path, collection, field.model, true)
      if (field.kind === 'array') mount('post', path, collection, field.model)
      else mount('post', itemPath, item, field.model)
      mount('get', itemPath, item, field.model)
      mount('patch', itemPath, item, field.model)
      mount('delete', itemPath, item, field.model)
      walk(field.model, itemPath, item)
    }
  }

  walk(root, `/${name}/:rootId`, [])
}
