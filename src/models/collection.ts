import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import { BaseController } from '#controllers/controller.ts'
import { publicModel } from '#models/embedded.ts'
import { assertResourceModel } from '#models/resource.ts'

type ControllerConstructor<C extends ControllerInterface> = new (backend: Backend) => C
type Options<C extends ControllerInterface> = {
  controller?: ControllerConstructor<C>
  outputValidator?: z.ZodObject
  associations?: Collection[]
}

const factories = new WeakMap<object, (backend: Backend) => unknown>()
const controllers = new WeakMap<object, unknown>()

/** Checks whether a collection has already been attached to an app. */
export function isAttached(collection: object): boolean {
  return controllers.has(collection)
}

/** Constructs and attaches the collection's selected controller. */
export function attachCollection(collection: object, backend: Backend): void {
  bindCollection(collection, createCollectionController(collection, backend))
}

/** Constructs a controller before any collection is attached. */
export function createCollectionController(collection: object, backend: Backend): unknown {
  const create = factories.get(collection)

  if (!create) throw new TypeError('Expected a Collection')

  return create(backend)
}

/** Attaches a successfully constructed controller. */
export function bindCollection(collection: object, controller: unknown): void {
  controllers.set(collection, controller)
}

export class Collection<S extends z.ZodObject = z.ZodObject, C extends ControllerInterface = ControllerInterface> {
  readonly name: string
  readonly model: S
  readonly endpoint: string
  readonly outputValidator: z.ZodObject
  readonly associations: readonly Collection[]

  /** Defines a named resource collection and selects its controller and public output. */
  constructor(
    name: string,
    model: S,
    ...[options]: ControllerInterface extends C
      ? [options?: Options<C>]
      : [options: Options<C> & { controller: ControllerConstructor<C> }]
  ) {
    this.name = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .parse(name)
    assertResourceModel(model)
    this.model = model
    this.endpoint = `/${this.name}`
    const parsed = z
      .strictObject({
        controller: z.custom<ControllerConstructor<C>>((value) => typeof value === 'function').optional(),
        outputValidator: z.instanceof(z.ZodObject).optional(),
        associations: z.array(z.instanceof(Collection)).optional(),
      })
      .parse(options === undefined ? {} : options)
    const selected = parsed.controller ?? (BaseController as unknown as ControllerConstructor<C>)

    this.outputValidator = parsed.outputValidator ?? publicModel(model)
    this.associations = Object.freeze(parsed.associations ?? [])
    factories.set(this, (backend) => new selected(backend))
  }

  /** Returns the controller created during registration. */
  get controller(): C {
    const controller = controllers.get(this)

    if (!controller) throw new Error('Collection must be registered before use')

    return controller as C
  }
}
