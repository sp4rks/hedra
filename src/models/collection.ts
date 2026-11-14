import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import { BaseController } from '#controllers/controller.ts'
import { ConfigurationError } from '#errors'
import { assertResourceModel } from '#models/resource.ts'

type ControllerConstructor<C extends ControllerInterface> = new (backend: Backend) => C
type Options<C extends ControllerInterface> = {
  controller?: ControllerConstructor<C>
  associations?: Collection[]
}

export class Collection<S extends z.ZodObject = z.ZodObject, C extends ControllerInterface = ControllerInterface> {
  readonly name: string
  readonly model: S
  readonly endpoint: string
  readonly associations: readonly Collection[]
  readonly #controllerConstructor: ControllerConstructor<C>
  #controller?: C

  /** Defines a named resource collection and selects its controller. */
  constructor(
    name: string,
    model: S,
    ...[options]: ControllerInterface extends C
      ? [options?: Options<C>]
      : [options: Options<C> & { controller: ControllerConstructor<C> }]
  ) {
    const parsedName = z
      .string()
      .regex(/^[a-z][a-z0-9_-]*$/)
      .safeParse(name)

    if (!parsedName.success) throw new ConfigurationError('configuration error', parsedName.error.issues)
    this.name = parsedName.data
    assertResourceModel(model)
    this.model = model
    const parsedOptions = z
      .strictObject({
        controller: z.custom<ControllerConstructor<C>>((value) => typeof value === 'function').optional(),
        associations: z.array(z.instanceof(Collection)).optional(),
      })
      .safeParse(options === undefined ? {} : options)

    if (!parsedOptions.success) throw new ConfigurationError('configuration error', parsedOptions.error.issues)
    const parsed = parsedOptions.data

    this.endpoint = `/${this.name}`
    this.associations = Object.freeze(parsed.associations ?? [])
    this.#controllerConstructor = parsed.controller ?? (BaseController as unknown as ControllerConstructor<C>)
  }

  /**
   * Checks whether this collection has already been attached to an app.
   * @internal
   */
  get isAttached(): boolean {
    return this.#controller !== undefined
  }

  /**
   * Constructs the selected controller without attaching it.
   * @internal
   */
  createController(backend: Backend): C {
    return new this.#controllerConstructor(backend)
  }

  /**
   * Attaches a successfully constructed controller.
   * @internal
   */
  bindController(controller: C): void {
    this.#controller = controller
  }

  /** Returns the controller created during registration. */
  get controller(): C {
    const controller = this.#controller

    if (!controller) throw new ConfigurationError('Collection must be registered before use')

    return controller
  }
}
