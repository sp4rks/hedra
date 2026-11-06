import type { Context } from 'hono'
import { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { Collection } from '#models/collection.ts'
import type { EmbeddedField } from '#models/embedded.ts'
import type { JsonApiListResponse, JsonApiResponse, ResourceInput } from '#models/rest.ts'
import type { EmbeddedScope, EmbeddedStep } from '#models/scope.ts'
import { assertAssociationScope } from '#controllers/associations.ts'
import { project } from '#controllers/projection.ts'
import { validateCandidate } from '#controllers/validation.ts'
import { HedraError, InputValidationError, RecordNotFoundError } from '#errors'
import { embeddedFields } from '#models/embedded.ts'
import { ResourceInput as InputSchema } from '#models/rest.ts'
import { getAssociationScope } from '#models/scope.ts'

type ObjectValue = Record<string, unknown>

/** Checks and snapshots an embedded object's attributes. */
function object(value: unknown): ObjectValue {
  const parsed = z.record(z.string(), z.unknown()).safeParse(value)

  if (!parsed.success) throw new InputValidationError()

  return value as ObjectValue
}

/** Reconciles nested input with existing identities and controlled timestamps. */
export function prepareEmbedded(
  model: z.ZodObject,
  attributes: ObjectValue,
  previous: ObjectValue | undefined,
  timestamp: string,
): ObjectValue {
  const result = { ...attributes }

  for (const field of embeddedFields(model)) {
    if (!Object.hasOwn(attributes, field.name)) continue
    const value = attributes[field.name]
    const existing = previous?.[field.name]

    if (value === null || value === undefined) continue
    const oldItems =
      field.kind === 'array' && Array.isArray(existing)
        ? existing.map(object)
        : field.kind === 'dictionary' && existing && typeof existing === 'object' && !Array.isArray(existing)
          ? Object.values(existing).map(object)
          : field.kind === 'single' && existing && typeof existing === 'object' && !Array.isArray(existing)
            ? [object(existing)]
            : []
    const seen = new Set<string>()
    const item = (candidate: unknown, oldAtKey?: unknown): ObjectValue => {
      const incoming = object(candidate)
      const requestedId = incoming.id
      let old: ObjectValue | undefined

      if (previous && requestedId !== undefined) {
        if (typeof requestedId !== 'string' || seen.has(requestedId)) throw new InputValidationError()
        old = oldItems.find((entry) => entry.id === requestedId)
        if (!old) throw new InputValidationError()
      } else if (previous && oldAtKey !== undefined) old = object(oldAtKey)
      const id = typeof old?.id === 'string' ? old.id : crypto.randomUUID()

      if (seen.has(id)) throw new InputValidationError()
      seen.add(id)
      delete incoming.id
      delete incoming.createdAt
      delete incoming.updatedAt
      const prepared = prepareEmbedded(field.model, incoming, old, timestamp)

      return { ...prepared, id, createdAt: old?.createdAt ?? timestamp, updatedAt: timestamp }
    }

    if (field.kind === 'array') {
      if (!Array.isArray(value)) throw new InputValidationError()
      result[field.name] = value.map((entry) => item(entry))
    } else if (field.kind === 'dictionary') {
      const entries = Object.entries(object(value)).map(([key, entry]) => {
        const old =
          existing && typeof existing === 'object' && Object.hasOwn(existing, key)
            ? (existing as ObjectValue)[key]
            : undefined

        return [key, item(entry, old)]
      })

      result[field.name] = Object.fromEntries(entries)
    } else result[field.name] = item(value, existing)
  }

  return result
}

/** Retrieves an embedded item without accepting another owner's ID. */
function selected(parent: ObjectValue, step: EmbeddedStep): ObjectValue {
  const container = parent[step.field.name]
  let item: unknown

  if (step.field.kind === 'array')
    item = Array.isArray(container) ? container.find((entry) => object(entry).id === step.selector) : undefined
  else if (step.field.kind === 'dictionary') {
    item =
      container && typeof container === 'object' && step.selector && Object.hasOwn(container, step.selector)
        ? (container as ObjectValue)[step.selector]
        : undefined
  } else item = container
  if (item === null || item === undefined) throw new RecordNotFoundError()

  return object(item)
}

/** Finds the parent object and every containing resource in a nested path. */
function parentOf(root: ObjectValue, steps: EmbeddedStep[]): { parent: ObjectValue; ancestors: ObjectValue[] } {
  let parent = root
  const ancestors = [root]

  for (const step of steps.slice(0, -1)) {
    parent = selected(parent, step)
    ancestors.push(parent)
  }

  return { parent, ancestors }
}

/** Writes a literal property name without invoking prototype setters. */
function set(objectValue: ObjectValue, key: string, value: unknown): void {
  Object.defineProperty(objectValue, key, { value, writable: true, enumerable: true, configurable: true })
}

/** Finds the top-level resource for a generated embedded route. */
async function rootRecord(
  backend: Backend,
  collection: Collection,
  context: Context,
  scope: EmbeddedScope,
): Promise<DatabaseRecord> {
  const ancestors = getAssociationScope(context)
  const records = ancestors
    ? await backend.transaction((transaction) => {
        assertAssociationScope(transaction, ancestors, { collection: collection.name, id: scope.rootId })

        return transaction.select(collection.name, { id: scope.rootId })
      })
    : await backend.select(collection.name, { id: scope.rootId })
  const record = records[0]

  if (!record) throw new RecordNotFoundError()

  return record
}

/** Builds the nested resource URL for a request and an optional new item. */
function itemLink(context: Context, field: EmbeddedField, selector?: string): string {
  const url = new URL(context.req.url)

  url.search = ''
  url.hash = ''
  if (selector !== undefined && field.kind !== 'single')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(selector)}`

  return url.toString()
}

/** Returns one embedded resource after applying the containing resource's public policy. */
export async function embeddedId(
  backend: Backend,
  collection: Collection,
  context: Context,
  scope: EmbeddedScope,
): Promise<JsonApiResponse> {
  const root = await rootRecord(backend, collection, context, scope)
  const step = scope.steps.at(-1)

  if (!step) throw new Error('Missing embedded route')
  selected(parentOf(root, scope.steps).parent, step)
  const visible = project(collection, root)
  const data = InputSchema.parse(selected(parentOf(visible, scope.steps).parent, step))

  return { data, links: { self: itemLink(context, step.field) } }
}

/** Returns a filtered embedded array or dictionary with the containing output policy. */
export async function embeddedList(
  backend: Backend,
  collection: Collection,
  context: Context,
  scope: EmbeddedScope,
  baseUrl: string,
  filter: Record<string, unknown> = {},
): Promise<JsonApiListResponse> {
  const root = await rootRecord(backend, collection, context, scope)
  const step = scope.steps.at(-1)

  if (!step) throw new Error('Missing embedded route')
  const stored = parentOf(root, scope.steps).parent[step.field.name]
  const visible = parentOf(project(collection, root), scope.steps).parent[step.field.name]
  const matches = (item: unknown) => Object.entries(filter).every(([key, value]) => object(item)[key] === value)

  if (step.field.kind === 'array') {
    const originals = Array.isArray(stored) ? stored : []
    const projected = Array.isArray(visible) ? visible : []
    const ids = new Set(originals.filter(matches).map((item) => object(item).id))

    return {
      data: projected.filter((item) => ids.has(object(item).id)).map((item) => InputSchema.parse(item)),
      links: { self: baseUrl },
    }
  }
  const originals = stored && typeof stored === 'object' ? object(stored) : {}
  const projected = visible && typeof visible === 'object' ? object(visible) : {}
  const data = Object.fromEntries(
    Object.entries(projected)
      .filter(([key]) => Object.hasOwn(originals, key) && matches(originals[key]))
      .map(([key, item]) => [key, InputSchema.parse(item)]),
  )

  return { data, links: { self: baseUrl } }
}

/** Mutates one embedded value inside its containing resource's atomic update. */
export async function embeddedMutate(
  backend: Backend,
  collection: Collection,
  context: Context,
  scope: EmbeddedScope,
  operation: 'create' | 'update' | 'delete',
  attributes: ObjectValue = {},
): Promise<JsonApiResponse | undefined> {
  const step = scope.steps.at(-1)

  if (!step) throw new Error('Missing embedded route')
  let data: ResourceInput | undefined
  let selector = step.selector
  const modify = (record: DatabaseRecord): DatabaseRecord => {
    const root = structuredClone(record)
    const { parent, ancestors } = parentOf(root, scope.steps)
    const timestamp = new Date().toISOString()
    const current = parent[step.field.name]

    if (operation === 'create') {
      const fields = prepareEmbedded(step.field.model, attributes, undefined, timestamp)
      const created = { ...fields, id: crypto.randomUUID(), createdAt: timestamp, updatedAt: timestamp }

      if (step.field.kind === 'array') {
        if (current !== undefined && !Array.isArray(current)) throw new Error('Invalid embedded array')
        set(parent, step.field.name, [...(Array.isArray(current) ? current : []), created])
        selector = created.id
      } else if (step.field.kind === 'dictionary') {
        if (!selector) throw new InputValidationError()
        const entries = current === undefined ? {} : object(current)

        if (Object.hasOwn(entries, selector)) throw new HedraError(409, 'embedded key already exists')
        set(entries, selector, created)
        set(parent, step.field.name, entries)
      } else {
        if (current !== undefined && current !== null) throw new HedraError(409, 'embedded resource already exists')
        set(parent, step.field.name, created)
      }
    } else {
      const existing = selected(parent, step)

      if (operation === 'update') {
        const changes = prepareEmbedded(step.field.model, attributes, existing, timestamp)
        const updated = {
          ...existing,
          ...changes,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        }

        if (step.field.kind === 'array') {
          set(
            parent,
            step.field.name,
            (current as unknown[]).map((entry) => (object(entry).id === step.selector ? updated : entry)),
          )
        } else if (step.field.kind === 'dictionary') set(object(current), step.selector as string, updated)
        else set(parent, step.field.name, updated)
      } else if (step.field.kind === 'array') {
        set(
          parent,
          step.field.name,
          (current as unknown[]).filter((entry) => object(entry).id !== step.selector),
        )
      } else if (step.field.kind === 'dictionary') delete object(current)[step.selector as string]
      else if (step.field.schema.safeParse(undefined).success) delete parent[step.field.name]
      else if (step.field.schema.safeParse(null).success) set(parent, step.field.name, null)
      else throw new InputValidationError()
    }

    for (const ancestor of ancestors) ancestor.updatedAt = timestamp
    const validated = validateCandidate(collection.model, root)
    const visible = project(collection, validated)

    if (operation !== 'delete') {
      const visibleParent = parentOf(visible, scope.steps).parent
      const visibleStep = { ...step, selector }

      data = InputSchema.parse(selected(visibleParent, visibleStep))
    }

    return validated
  }
  const ancestors = getAssociationScope(context)
  const result = ancestors
    ? await backend.transaction((transaction) => {
        assertAssociationScope(transaction, ancestors, { collection: collection.name, id: scope.rootId })

        return transaction.update(collection.name, scope.rootId, modify)
      })
    : await backend.update(collection.name, scope.rootId, modify)

  if (!result) throw new RecordNotFoundError()
  if (operation === 'delete') return undefined
  if (!data) throw new Error('Embedded update did not return public data')

  return { data, links: { self: itemLink(context, step.field, operation === 'create' ? selector : undefined) } }
}
