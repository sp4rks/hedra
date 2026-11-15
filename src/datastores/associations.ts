import type { z } from 'zod'

import type { Backend, BackendTransaction, DatabaseRecord } from '#datastores/backend.ts'
import type { Association, ResourceReference } from '#models/resource.ts'
import { ConflictError, InputValidationError, OutputValidationError, parseInput, RecordNotFoundError } from '#errors'
import { Domain } from '#models/domain.ts'
import { Association as AssociationSchema, ResourceReference as ReferenceSchema } from '#models/resource.ts'

export const associationTable = 'hedra_associations'

/** Converts one stored association to its public value. */
function publicAssociation(record: DatabaseRecord): Association {
  const parsed = AssociationSchema.safeParse({
    id: record.id,
    environmentDomain: record.environmentDomain,
    source: { collection: record.sourceCollection, id: record.sourceId },
    target: { collection: record.targetCollection, id: record.targetId },
  })

  if (!parsed.success) throw new OutputValidationError('output validation error', parsed.error.issues)

  return parsed.data
}

/** Reads the exact association between two resource references. */
function matching(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
  environmentDomain: string,
): DatabaseRecord[] {
  return transaction.select(associationTable, {
    environmentDomain,
    sourceCollection: source.collection,
    sourceId: source.id,
    targetCollection: target.collection,
    targetId: target.id,
  })
}

/** Ensures a resource exists within the current transaction. */
export function assertResource(
  transaction: BackendTransaction,
  reference: ResourceReference,
  environmentDomain: string,
): void {
  if (!transaction.select(reference.collection, { id: reference.id, environmentDomain }).length)
    throw new RecordNotFoundError()
}

/** Adds a link between existing resources, preserving uniqueness. */
export function addAssociation(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
  environmentDomain: string,
): Association {
  assertResource(transaction, source, environmentDomain)
  assertResource(transaction, target, environmentDomain)
  const existing = matching(transaction, source, target, environmentDomain)[0]

  if (existing) return publicAssociation(existing)
  const record: DatabaseRecord = {
    environmentDomain,
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
export function associationsFor(
  transaction: BackendTransaction,
  reference: ResourceReference,
  environmentDomain: string,
): Association[] {
  const source = transaction.select(associationTable, {
    environmentDomain,
    sourceCollection: reference.collection,
    sourceId: reference.id,
  })
  const target = transaction.select(associationTable, {
    environmentDomain,
    targetCollection: reference.collection,
    targetId: reference.id,
  })
  const unique = new Map([...source, ...target].map((record) => [record.id, record]))

  return [...unique.values()].map(publicAssociation)
}

/** Prevents deletion until every association has been removed. */
export function assertUnassociated(
  transaction: BackendTransaction,
  reference: ResourceReference,
  environmentDomain: string,
): void {
  const associations = associationsFor(transaction, reference, environmentDomain)

  if (associations.length) throw new ConflictError('resource has associations', { associations })
}

/** Deletes one existing association without touching its endpoints. */
function removeAssociation(
  transaction: BackendTransaction,
  source: ResourceReference,
  target: ResourceReference,
  environmentDomain: string,
): boolean {
  assertResource(transaction, source, environmentDomain)
  assertResource(transaction, target, environmentDomain)
  const association = matching(transaction, source, target, environmentDomain)[0]

  return association ? transaction.delete(associationTable, association.id) : false
}

export class AssociationOperations {
  /** Uses the app's guarded backend and registered collection definitions. */
  constructor(
    private readonly backend: () => Backend,
    private readonly collection: (
      name: string,
    ) => { model: z.ZodObject; associations: readonly z.ZodObject[] } | undefined,
  ) {}

  /** Validates that the selected source declares the target association. */
  private references(source: ResourceReference, target: ResourceReference): [ResourceReference, ResourceReference] {
    const from = parseInput(ReferenceSchema, source)
    const to = parseInput(ReferenceSchema, target)
    const definition = this.collection(from.collection)
    const destination = this.collection(to.collection)

    if (!definition || !destination || !definition.associations.includes(destination.model))
      throw new InputValidationError()

    return [from, to]
  }

  /** Links registered resources once. */
  async link(environmentDomain: string, source: ResourceReference, target: ResourceReference): Promise<Association> {
    const owner = parseInput(Domain, environmentDomain)
    const [from, to] = this.references(source, target)

    return await this.backend().transaction((transaction) => addAssociation(transaction, from, to, owner))
  }

  /** Lists every association involving a registered resource. */
  async list(environmentDomain: string, reference: ResourceReference): Promise<Association[]> {
    const owner = parseInput(Domain, environmentDomain)
    const parsed = parseInput(ReferenceSchema, reference)

    if (!this.collection(parsed.collection)) throw new InputValidationError()

    return await this.backend().transaction((transaction) => {
      assertResource(transaction, parsed, owner)

      return associationsFor(transaction, parsed, owner)
    })
  }

  /** Removes a link while retaining both resources. */
  async unlink(environmentDomain: string, source: ResourceReference, target: ResourceReference): Promise<boolean> {
    const owner = parseInput(Domain, environmentDomain)
    const [from, to] = this.references(source, target)

    return await this.backend().transaction((transaction) => removeAssociation(transaction, from, to, owner))
  }
}
