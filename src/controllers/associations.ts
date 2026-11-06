import type { Context } from 'hono'

import type { Backend, BackendTransaction, DatabaseRecord } from '#datastores/backend.ts'
import type { Association, ResourceReference } from '#models/association.ts'
import type { Collection } from '#models/collection.ts'
import { HedraError, InputValidationError, RecordNotFoundError } from '#errors'
import { Association as AssociationSchema, ResourceReference as ReferenceSchema } from '#models/association.ts'
import { getAssociationScope } from '#models/scope.ts'

export const associationTable = 'hedra_associations'

/** Converts one stored association to its public value. */
function publicAssociation(record: DatabaseRecord): Association {
  return AssociationSchema.parse({
    id: record.id,
    source: { collection: record.sourceCollection, id: record.sourceId },
    target: { collection: record.targetCollection, id: record.targetId },
  })
}

/** Reads the exact association between two resource references. */
function matching(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
): DatabaseRecord[] {
  return transaction.select(associationTable, {
    sourceCollection: source.collection,
    sourceId: source.id,
    targetCollection: target.collection,
    targetId: target.id,
  })
}

/** Ensures a resource exists within the current transaction. */
export function assertResource(transaction: BackendTransaction, reference: ResourceReference): void {
  if (!transaction.select(reference.collection, { id: reference.id }).length) throw new RecordNotFoundError()
}

/** Verifies every ancestor and navigation link before a scoped operation. */
export function assertAssociationScope(
  transaction: BackendTransaction,
  ancestors: ResourceReference[],
  target?: ResourceReference,
): void {
  for (let index = 0; index < ancestors.length; index++) {
    const current = ancestors[index]
    const previous = ancestors[index - 1]

    if (!current) continue
    assertResource(transaction, current)
    if (previous && !matching(transaction, previous, current).length) throw new RecordNotFoundError()
  }
  if (target) {
    assertResource(transaction, target)
    const previous = ancestors.at(-1)

    if (previous && !matching(transaction, previous, target).length) throw new RecordNotFoundError()
  }
}

/** Adds a link between existing resources, preserving uniqueness. */
export function addAssociation(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
): Association {
  assertResource(transaction, source)
  assertResource(transaction, target)
  const existing = matching(transaction, source, target)[0]

  if (existing) return publicAssociation(existing)
  const record: DatabaseRecord = {
    id: crypto.randomUUID(),
    sourceCollection: source.collection,
    sourceId: source.id,
    targetCollection: target.collection,
    targetId: target.id,
  }

  transaction.insert(associationTable, record)

  return publicAssociation(record)
}

/** Lists all links involving a resource. */
export function associationsFor(transaction: BackendTransaction, reference: ResourceReference): Association[] {
  const source = transaction.select(associationTable, {
    sourceCollection: reference.collection,
    sourceId: reference.id,
  })
  const target = transaction.select(associationTable, {
    targetCollection: reference.collection,
    targetId: reference.id,
  })
  const unique = new Map([...source, ...target].map((record) => [record.id, record]))

  return [...unique.values()].map(publicAssociation)
}

/** Prevents deletion until every association has been removed. */
export function assertUnassociated(transaction: BackendTransaction, reference: ResourceReference): void {
  const associations = associationsFor(transaction, reference)

  if (associations.length) throw new HedraError(409, 'resource has associations', { associations })
}

/** Deletes one existing association without touching its endpoints. */
function removeAssociation(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
): boolean {
  assertResource(transaction, source)
  assertResource(transaction, target)
  const association = matching(transaction, source, target)[0]

  return association ? transaction.delete(associationTable, association.id) : false
}

export class AssociationOperations {
  /** Uses the app's guarded backend and registered collection definitions. */
  constructor(
    private readonly backend: () => Backend,
    private readonly collection: (name: string) => Collection | undefined,
  ) {}

  /** Validates that the selected source declares the target association. */
  private references(source: ResourceReference, target: ResourceReference): [ResourceReference, ResourceReference] {
    const from = ReferenceSchema.parse(source)
    const to = ReferenceSchema.parse(target)
    const definition = this.collection(from.collection)
    const destination = this.collection(to.collection)

    if (!definition || !destination || !definition.associations.includes(destination)) throw new InputValidationError()

    return [from, to]
  }

  /** Links registered resources once. */
  async link(source: ResourceReference, target: ResourceReference): Promise<Association> {
    const [from, to] = this.references(source, target)

    return this.backend().transaction((transaction) => addAssociation(transaction, from, to))
  }

  /** Lists every association involving a registered resource. */
  async list(reference: ResourceReference): Promise<Association[]> {
    const parsed = ReferenceSchema.parse(reference)

    if (!this.collection(parsed.collection)) throw new InputValidationError()

    return this.backend().transaction((transaction) => {
      assertResource(transaction, parsed)

      return associationsFor(transaction, parsed)
    })
  }

  /** Removes a link while retaining both resources. */
  async unlink(source: ResourceReference, target: ResourceReference): Promise<boolean> {
    const [from, to] = this.references(source, target)

    return this.backend().transaction((transaction) => removeAssociation(transaction, from, to))
  }

  /** Removes a link after checking every generated-route ancestor. */
  async unlinkFrom(context: Context, source: ResourceReference, target: ResourceReference): Promise<void> {
    const [from, to] = this.references(source, target)
    const ancestors = getAssociationScope(context) ?? []

    await this.backend().transaction((transaction) => {
      assertAssociationScope(transaction, ancestors, from)
      if (!removeAssociation(transaction, from, to)) throw new RecordNotFoundError()
    })
  }
}
