import type { Context } from 'hono'
import type { z } from 'zod'

import type { Backend, DatabaseRecord } from '#datastores/backend.ts'
import type { ChildField } from '#models/children.ts'
import type { ChildStep, ResourceScope } from '#models/scope.ts'
import { validateCandidate } from '#controllers/validation.ts'
import { ConflictError, HedraError, InputValidationError, OutputValidationError, RecordNotFoundError } from '#errors'
import { assertChildOwnership, childFields, safeChildKey } from '#models/children.ts'
import { requireRequestScope } from '#models/request-scope.ts'
import { Resource, resourceName } from '#models/resource.ts'
import { getResourceScope } from '#models/scope.ts'

type ObjectValue = Record<string, unknown>
export type ChildTarget = Extract<ResourceScope['target'], { kind: 'child' }>

/** Requires a plain child object before inspecting its data or managed metadata. */
export function childObject(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputValidationError('Invalid child value')

  return value as ObjectValue
}

/** Resolves the request's nested address without sharing state across requests. */
export function childTarget(context: Context): ChildTarget | undefined {
  const scope = getResourceScope(context)

  return scope?.target.kind === 'child' ? scope.target : undefined
}

/** Checks nested ownership on raw child input before generic serialization can evaluate getters. */
export function assertChildInput(root: z.ZodObject, target: ChildTarget, input: ObjectValue): void {
  let model = root

  for (const step of target.steps) {
    const field = childFields(model).find(
      (candidate) => candidate.name === step.field && candidate.kind === step.selector.kind,
    )

    if (!field) throw new InputValidationError('Invalid child address')
    model = field.model
  }
  assertChildOwnership(model, input)
}

/** Reconciles submitted children only against identities at their existing parent placement. */
export function prepareChildren(
  model: z.ZodObject,
  input: ObjectValue,
  previous: ObjectValue | undefined,
  timestamp: string,
  owner: string,
  defaults = false,
): ObjectValue {
  if (!defaults) assertChildOwnership(model, input)
  const result = { ...input }

  for (const field of childFields(model)) {
    const submitted = Object.hasOwn(input, field.name)
    const fallback = !submitted && !previous ? field.schema.safeParse(undefined) : undefined

    if (!submitted && !fallback?.success) continue
    const value = submitted ? input[field.name] : fallback?.data

    if (!submitted && value !== undefined) result[field.name] = value
    const existing = previous?.[field.name]

    if (value === null || value === undefined) continue
    if (field.kind === 'object') {
      result[field.name] = prepareChildren(
        field.model,
        childObject(value),
        existing === undefined || existing === null ? undefined : childObject(existing),
        timestamp,
        owner,
        defaults || !submitted,
      )
      continue
    }
    const old =
      field.kind === 'array' && Array.isArray(existing)
        ? existing
        : field.kind === 'dictionary' && existing
          ? Object.values(childObject(existing))
          : existing
            ? [existing]
            : []
    const seen = new Set<string>()
    /** Assigns fresh metadata or retains a known identity in this exact placement. */
    const prepare = (candidate: unknown, key?: string): ObjectValue => {
      const incoming = childObject(candidate)
      let prior: ObjectValue | undefined

      if (previous && incoming.id !== undefined) {
        if (typeof incoming.id !== 'string') throw new InputValidationError('Invalid child identity')
        const selected =
          field.kind === 'dictionary' && key !== undefined && existing ? childObject(existing)[key] : undefined

        prior =
          field.kind === 'dictionary'
            ? selected === undefined
              ? undefined
              : childObject(selected)
            : old.map(childObject).find((item) => item.id === incoming.id)
        if (!prior || prior.id !== incoming.id) throw new InputValidationError('Unknown child identity')
      }
      const id = typeof prior?.id === 'string' ? prior.id : crypto.randomUUID()

      if (seen.has(id)) throw new InputValidationError('Duplicate child identity')
      seen.add(id)
      if (submitted && !defaults && Object.hasOwn(incoming, 'environmentDomain'))
        throw new InputValidationError('Child ownership is managed by the server')
      const { id: _id, createdAt: _created, updatedAt: _updated, environmentDomain: _owner, ...attributes } = incoming
      const prepared = prepareChildren(field.model, attributes, prior, timestamp, owner, defaults || !submitted)

      return {
        ...prepared,
        id,
        createdAt: prior?.createdAt ?? timestamp,
        updatedAt: timestamp,
        environmentDomain: owner,
      }
    }

    if (field.kind === 'array') {
      if (!Array.isArray(value)) throw new InputValidationError()
      result[field.name] = value.map((item) => prepare(item))
    } else if (field.kind === 'dictionary') {
      result[field.name] = Object.fromEntries(
        Object.entries(childObject(value)).map(([key, item]) => [safeChildKey(key), prepare(item, key)]),
      )
    } else result[field.name] = prepare(value)
  }

  return result
}

/** Validates managed metadata recursively without parsing private application attributes. */
export function assertChildValues(
  model: z.ZodObject,
  root: ObjectValue,
  owner: string,
  ErrorClass: typeof InputValidationError | typeof OutputValidationError,
): void {
  for (const field of childFields(model)) {
    const value = root[field.name]

    if (value === undefined || value === null) {
      if (!(value === undefined ? field.schema.isOptional() : field.schema.isNullable()))
        throw new ErrorClass('Missing managed child placement')
      continue
    }
    if (field.kind === 'array' && !Array.isArray(value)) throw new ErrorClass('Invalid managed child array')
    if (field.kind !== 'array' && (typeof value !== 'object' || Array.isArray(value)))
      throw new ErrorClass('Invalid managed child container')
    const items =
      field.kind === 'array' ? (value as unknown[]) : field.kind === 'dictionary' ? Object.values(value) : [value]
    const ids = new Set<string>()

    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ErrorClass('Invalid managed child')
      const child = item as ObjectValue

      if (field.kind !== 'object') {
        const parsed = Resource.pick({ id: true, createdAt: true, updatedAt: true, environmentDomain: true }).safeParse(
          child,
        )

        if (!parsed.success) throw new ErrorClass('Invalid managed child metadata', parsed.error.issues)
        if (child.environmentDomain !== owner || ids.has(parsed.data.id))
          throw new ErrorClass('Invalid managed child ownership or identity')
        ids.add(parsed.data.id)
      }
      assertChildValues(field.model, child, owner, ErrorClass)
    }
  }
}

/** Rejects model transforms that alter any child's identity, ownership or audit metadata. */
export function assertChildMetadata(model: z.ZodObject, before: ObjectValue, after: ObjectValue): void {
  for (const field of childFields(model)) {
    const original = before[field.name]
    const result = after[field.name]

    if (original === undefined || original === null) {
      if (result !== original) throw new InputValidationError('Model changed child placement')
      continue
    }
    if (field.kind === 'object') {
      assertChildMetadata(field.model, childObject(original), childObject(result))
      continue
    }
    const entries =
      field.kind === 'array'
        ? (original as unknown[]).map((item) => [String(childObject(item).id), item] as const)
        : field.kind === 'dictionary'
          ? Object.entries(childObject(original))
          : [['single', original] as const]

    if (
      field.kind === 'array' &&
      (!Array.isArray(result) ||
        result.length !== entries.length ||
        new Set(result.map((item) => childObject(item).id)).size !== result.length)
    )
      throw new InputValidationError('Model changed child identities')
    const values =
      field.kind === 'array' && Array.isArray(result)
        ? Object.fromEntries(result.map((item) => [String(childObject(item).id), item]))
        : field.kind === 'dictionary' && result
          ? childObject(result)
          : { single: result }

    if (Object.keys(values).length !== entries.length) throw new InputValidationError('Model changed child identities')

    for (const [key, item] of entries) {
      const old = childObject(item)
      const current = childObject(values[key])

      for (const metadata of ['id', 'createdAt', 'updatedAt', 'environmentDomain'])
        if (current[metadata] !== old[metadata]) throw new InputValidationError('Model changed child metadata')
      assertChildMetadata(field.model, old, current)
    }
  }
}

/** Locates a declared placement and its selected value without crossing parent boundaries. */
export function childPlacement(
  root: ObjectValue,
  model: z.ZodObject,
  steps: ChildStep[],
): { parent: ObjectValue; field: ChildField; step: ChildStep; value: unknown; ancestors: ObjectValue[] } {
  let parent = root
  let currentModel = model
  const ancestors = [root]

  for (const [index, step] of steps.entries()) {
    const field = childFields(currentModel).find((item) => item.name === step.field)

    if (!field || field.kind !== step.selector.kind) throw new InputValidationError('Invalid child address')
    const container = parent[field.name]
    let value: unknown

    if (step.selector.kind === 'array') {
      const id = step.selector.id

      value =
        id === undefined
          ? container
          : Array.isArray(container)
            ? container.find((item) => childObject(item).id === id)
            : undefined
    } else if (step.selector.kind === 'dictionary') {
      const key = step.selector.key

      if (key !== undefined) {
        safeChildKey(key)
        const validated = field.key?.safeParse(key)

        if (!validated?.success || validated.data !== key) throw new InputValidationError('Invalid child key')
      }
      value =
        key === undefined
          ? container
          : container && Object.hasOwn(childObject(container), key)
            ? childObject(container)[key]
            : undefined
    } else value = container
    if (index === steps.length - 1) return { parent, field, step, value, ancestors }
    if (value === undefined || value === null) throw new RecordNotFoundError()
    parent = childObject(value)
    currentModel = field.model
    if (field.kind !== 'object') ancestors.push(parent)
  }

  throw new InputValidationError('Missing child address')
}

/** Reads the containing root and checks the complete selected path within the resolved environment. */
export async function readChildren(
  backend: Backend,
  context: Context,
  model: z.ZodObject,
  target: ChildTarget,
): Promise<DatabaseRecord> {
  const owner = requireRequestScope(context).environment.environmentDomain
  const root = (await backend.select(resourceName(model), { id: target.rootId, environmentDomain: owner }))[0]

  if (!root || root.environmentDomain !== owner) throw new RecordNotFoundError()
  if (root.id !== target.rootId) throw new OutputValidationError('Resource ID cannot change')
  assertChildValues(model, root, owner, OutputValidationError)
  const placement = childPlacement(root, model, target.steps)

  if (placement.value === undefined || placement.value === null) throw new RecordNotFoundError()

  return root
}

/** Atomically changes child JSON and returns the complete containing snapshot for web output validation. */
export async function mutateChildren(
  backend: Backend,
  context: Context,
  model: z.ZodObject,
  target: ChildTarget,
  operation: 'create' | 'update' | 'delete',
  input: ObjectValue = {},
): Promise<{ data: DatabaseRecord; links: { self: string } }> {
  const owner = requireRequestScope(context).environment.environmentDomain
  let data: DatabaseRecord | undefined
  let selectedId: string | undefined
  const result = await backend.update(resourceName(model), target.rootId, (stored) => {
    if (stored.environmentDomain !== owner) throw new RecordNotFoundError()
    if (stored.id !== target.rootId) throw new HedraError('Resource ID cannot change')
    assertChildValues(model, stored, owner, OutputValidationError)
    const root = structuredClone(stored)
    const { parent, field, step, value, ancestors } = childPlacement(root, model, target.steps)
    const timestamp = new Date().toISOString()
    let replacement: ObjectValue | undefined

    if (operation !== 'delete') {
      if (Object.hasOwn(input, 'environmentDomain'))
        throw new InputValidationError('Child ownership is managed by the server')
      let previous: ObjectValue | undefined

      if (operation === 'update') {
        if (value === undefined || value === null) throw new RecordNotFoundError()
        previous = childObject(value)
      }
      const { id: _id, createdAt: _created, updatedAt: _updated, environmentDomain: _owner, ...attributes } = input
      const prepared = prepareChildren(field.model, attributes, previous, timestamp, owner)

      replacement = {
        ...previous,
        ...prepared,
        id: previous?.id ?? crypto.randomUUID(),
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
        environmentDomain: owner,
      }
      selectedId = String(replacement.id)
    }
    if (step.selector.kind === 'array') {
      const current = parent[field.name]
      const entries = Array.isArray(current) ? current : []
      const id = step.selector.id

      if (operation === 'create') parent[field.name] = [...entries, replacement]
      else {
        if (value === undefined) throw new RecordNotFoundError()
        parent[field.name] =
          operation === 'delete'
            ? entries.filter((item) => childObject(item).id !== id)
            : entries.map((item) => (childObject(item).id === id ? replacement : item))
      }
    } else if (step.selector.kind === 'dictionary') {
      const key = step.selector.key

      if (!key) throw new InputValidationError('A dictionary key is required')
      if (operation === 'create' && value !== undefined) throw new ConflictError('Child key already exists')
      if (operation !== 'create' && value === undefined) throw new RecordNotFoundError()
      const entries =
        parent[field.name] === undefined || parent[field.name] === null ? {} : childObject(parent[field.name])

      if (operation === 'delete') delete entries[key]
      else
        Object.defineProperty(entries, key, {
          value: replacement,
          enumerable: true,
          configurable: true,
          writable: true,
        })
      parent[field.name] = entries
    } else {
      if (operation === 'create' && value !== undefined && value !== null)
        throw new ConflictError('Child already exists')
      if (operation !== 'create' && (value === undefined || value === null)) throw new RecordNotFoundError()
      if (operation !== 'delete') parent[field.name] = replacement
      else if (field.schema.safeParse(undefined).success) delete parent[field.name]
      else if (field.schema.safeParse(null).success) parent[field.name] = null
      else throw new InputValidationError('Required child cannot be deleted')
    }

    for (const ancestor of ancestors) ancestor.updatedAt = timestamp
    const validated = validateCandidate(model, root)

    assertChildMetadata(model, root, validated)
    assertChildValues(model, validated, owner, InputValidationError)
    data = validated

    return validated
  })

  if (!result) throw new RecordNotFoundError()
  if (!data) throw new HedraError('Backend did not apply the child mutation')
  const url = new URL(context.req.url)

  url.search = ''
  url.hash = ''
  if (operation === 'create' && target.steps.at(-1)?.selector.kind === 'array')
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${selectedId}`

  return { data, links: { self: url.toString() } }
}
