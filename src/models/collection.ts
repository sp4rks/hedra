import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import { BaseController } from '#controllers/controller.ts'
import { assertResourceModel } from '#models/resource.ts'

type ControllerConstructor<C extends ControllerInterface> = new (backend: Backend) => C
type Options<C extends ControllerInterface> = { controller?: ControllerConstructor<C>; outputValidator?: z.ZodObject }

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

export class Collection<S extends z.ZodObject = z.ZodObject, C extends ControllerInterface = ControllerInterface> {
  readonly name: string
  readonly model: S
  readonly endpoint: string
  readonly outputValidator: z.ZodObject

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
      })
      .parse(options === undefined ? {} : options)
    const shape = Object.fromEntries(Object.entries(model.shape).filter(([key]) => key !== 'password'))
    const selected = parsed.controller ?? (BaseController as unknown as ControllerConstructor<C>)

    this.outputValidator = parsed.outputValidator ?? z.object(shape)
    factories.set(this, (backend) => new selected(backend))
  }

  /** Returns the controller created during registration. */
  get controller(): C {
    const controller = controllers.get(this)

    if (!controller) throw new Error('Collection must be registered before use')

    return controller as C
  }
}
