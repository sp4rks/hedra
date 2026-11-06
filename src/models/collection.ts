import { z } from 'zod'

import type { Backend } from '#datastores/backend.ts'
import { Controller } from '#controllers/controller.ts'
import { assertResourceModel } from '#models/resource.ts'

type ControllerConstructor<S extends z.ZodObject, C extends Controller<S>> = new (
  name: string,
  model: S,
  backend: Backend,
) => C

const factories = new WeakMap<object, (backend: Backend) => unknown>()
const controllers = new WeakMap<object, unknown>()

/** Checks whether a collection has already been attached to an app. */
export function isAttached(collection: object): boolean {
  return controllers.has(collection)
}

/** Constructs and attaches the collection's selected controller. */
export function attachCollection(collection: object, backend: Backend): void {
  const create = factories.get(collection)

  if (!create) throw new TypeError('Expected a Collection')
  controllers.set(collection, create(backend))
}

export class Collection<S extends z.ZodObject, C extends Controller<S> = Controller<S>> {
  readonly name: string
  readonly model: S
  readonly endpoint: string

  /** Defines a named resource collection and selects its controller. */
  constructor(
    name: string,
    model: S,
    ...[controller]: Controller<S> extends C
      ? [controller?: ControllerConstructor<S, C>]
      : [controller: ControllerConstructor<S, C>]
  ) {
    this.name = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .parse(name)
    assertResourceModel(model)
    this.model = model
    this.endpoint = `/${this.name}`
    if (controller !== undefined && typeof controller !== 'function') throw new TypeError('Expected a controller class')
    const selected = controller ?? (Controller as unknown as ControllerConstructor<S, C>)

    factories.set(this, (backend) => new selected(this.name, this.model, backend))
  }

  /** Returns the controller created during registration. */
  get controller(): C {
    const controller = controllers.get(this)

    if (!controller) throw new Error('Collection must be registered before use')

    return controller as C
  }
}
