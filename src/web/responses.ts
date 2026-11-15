import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

import type { ChildTarget } from '#controllers'
import type { ResourceInput } from '#models/rest.ts'
import { assertChildValues, childObject, childPlacement, jsonString } from '#controllers'
import { HedraError, OutputValidationError } from '#errors'
import { childFields, safeChildKey } from '#models/children.ts'
import { ResourceId } from '#models/resource.ts'
import { ErrorResponse, JsonApiListResponse, JsonApiResponse, ResourceInput as ResourceSchema } from '#models/rest.ts'

const writeResponseFailure = 'Transaction succeeded, but response validation failed.'

/** Marks web response failures whose safe write-outcome detail may be returned. */
class ResponseValidationError extends OutputValidationError {}

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
export function response(
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
