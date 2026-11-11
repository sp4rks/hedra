import { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { Backend } from '#datastores/backend.ts'
import { BaseController } from '#controllers/controller.ts'
import { ConfigurationError } from '#errors'
import { embeddedFields, publicItem, publicModel } from '#models/embedded.ts'
import { assertResourceModel } from '#models/resource.ts'

type ControllerConstructor<C extends ControllerInterface> = new (backend: Backend) => C
type Options<C extends ControllerInterface> = {
  controller?: ControllerConstructor<C>
  outputValidator?: z.ZodObject
  associations?: Collection[]
  parent?: Collection
}

export class Collection<S extends z.ZodObject = z.ZodObject, C extends ControllerInterface = ControllerInterface> {
  readonly name: string
  readonly model: S
  readonly endpoint: string
  readonly outputValidator: z.ZodObject
  readonly associations: readonly Collection[]
  readonly parent?: Collection
  readonly #controllerConstructor: ControllerConstructor<C>
  readonly #children: Collection[] = []
  #controller?: C

  /** Defines a named resource collection and selects its controller and public output. */
  constructor(
    name: string,
    model: S,
    ...[options]: ControllerInterface extends C
      ? [options?: Options<C>]
      : [options: Options<C> & { controller: ControllerConstructor<C> }]
  ) {
    const parsedName = z
      .string()
      .regex(options?.parent ? /^[A-Za-z][A-Za-z0-9_-]*$/ : /^[a-z][a-z0-9_-]*$/)
      .safeParse(name)

    if (!parsedName.success) throw new ConfigurationError('configuration error', parsedName.error.issues)
    this.name = parsedName.data
    assertResourceModel(model)
    this.model = model
    const parsedOptions = z
      .strictObject({
        controller: z.custom<ControllerConstructor<C>>((value) => typeof value === 'function').optional(),
        outputValidator: z.instanceof(z.ZodObject).optional(),
        associations: z.array(z.instanceof(Collection)).optional(),
        parent: z.instanceof(Collection).optional(),
      })
      .safeParse(options === undefined ? {} : options)

    if (!parsedOptions.success) throw new ConfigurationError('configuration error', parsedOptions.error.issues)
    const parsed = parsedOptions.data

    const parent = parsed.parent
    const field = parent && embeddedFields(parent.model).find((item) => item.name === this.name)

    if (parent?.isAttached) throw new ConfigurationError('Parent collection is already attached')
    if (parent && (!field || field.model !== model)) throw new ConfigurationError('Parent field must match child model')
    if (parent && parsed.outputValidator) throw new ConfigurationError('Parent controls contained output')
    if (parent && parsed.associations?.length)
      throw new ConfigurationError('Contained collections cannot have associations')
    if (parsed.associations?.some((item) => item.parent))
      throw new ConfigurationError('Contained collections cannot have associations')
    if (parent?.children.some((item) => item.name === name)) throw new ConfigurationError('Duplicate child collection')
    this.parent = parent
    /** Counts the collection's containing ancestors for generated route parameters. */
    const depth = (item: Collection): number => (item.parent ? depth(item.parent) + 1 : 0)
    const parentField = parent?.parent && embeddedFields(parent.parent.model).find((item) => item.name === parent.name)

    this.endpoint = parent
      ? `${parent.endpoint}${!parent.parent || parentField?.kind !== 'single' ? `/:r${depth(parent)}` : ''}/${name}`
      : `/${name}`
    this.outputValidator =
      (parent && field ? publicItem(field, parent.outputValidator) : undefined) ??
      parsed.outputValidator ??
      publicModel(model)
    this.associations = Object.freeze(parsed.associations ?? [])
    this.#controllerConstructor = parsed.controller ?? (BaseController as unknown as ControllerConstructor<C>)
    if (parent) parent.#children.push(this)
  }

  /** Returns collections declared inside this collection. @internal */
  get children(): readonly Collection[] {
    return [...this.#children]
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
