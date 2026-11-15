import type { Hono, MiddlewareHandler } from 'hono'
import type { z } from 'zod'

import type { ControllerInterface } from '#controllers/controller.ts'
import type { ChildAddress } from '#web/children.ts'
import type { RouteValidators } from '#web/resources.ts'
import { childFields, resourceName } from '#models'
import { childHandler } from '#web/children.ts'
import { resourceHandlers } from '#web/resources.ts'
import { guardedMiddleware } from '#web/responses.ts'

/** Registers the actual web handlers behind one shared provisioning boundary. */
export function registerHandlers(
  app: Hono,
  path: string,
  handlers: ReturnType<typeof resourceHandlers>,
  middleware: MiddlewareHandler,
): void {
  app.get(path, middleware, handlers.list)
  app.post(path, middleware, handlers.create)
  app.get(`${path}/:${handlers.identity}`, middleware, handlers.id)
  app.patch(`${path}/:${handlers.identity}`, middleware, handlers.update)
  app.delete(`${path}/:${handlers.identity}`, middleware, handlers.delete)
}

/** Registers generated root and contained REST paths for an application resource. */
export function registerRoutes(
  app: Hono,
  model: z.ZodObject,
  controller: ControllerInterface,
  validators: RouteValidators = {},
  before: MiddlewareHandler,
): void {
  const handlers = resourceHandlers(model, controller, validators)
  const middleware = guardedMiddleware(before)

  registerHandlers(app, `/${resourceName(model)}`, handlers, middleware)
  registerChildRoutes(app, model, controller, handlers.output, middleware)
}

/** Registers finite child paths whose controllers always return containing-root snapshots. */
function registerChildRoutes(
  app: Hono,
  root: z.ZodObject,
  controller: ControllerInterface,
  output: z.ZodObject,
  middleware: MiddlewareHandler,
): void {
  const name = resourceName(root)
  /** Installs one nested operation using an explicit root UUID and ordered child selectors. */
  const mount = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    steps: ChildAddress[],
    model: z.ZodObject,
    list = false,
  ): void => {
    app[method](path, middleware, childHandler(root, controller, output, method, steps, model, list))
  }
  /** Walks only discovered managed placements; ordinary nested data gains no endpoints. */
  const walk = (model: z.ZodObject, prefix: string, ancestors: ChildAddress[]): void => {
    for (const field of childFields(model)) {
      const path = `${prefix}/${field.name}`

      if (field.kind === 'object') {
        walk(field.model, path, [...ancestors, { field: field.name, kind: 'object' }])
        continue
      }
      const parameter = `child${ancestors.length}`
      const collection = [...ancestors, { field: field.name, kind: field.kind }]
      const item = [
        ...ancestors,
        { field: field.name, kind: field.kind, ...(field.kind === 'single' ? {} : { parameter }) },
      ]
      const itemPath = field.kind === 'single' ? path : `${path}/:${parameter}`

      if (field.kind !== 'single') mount('get', path, collection, field.model, true)
      if (field.kind === 'array') mount('post', path, collection, field.model)
      else mount('post', itemPath, item, field.model)
      mount('get', itemPath, item, field.model)
      mount('patch', itemPath, item, field.model)
      mount('delete', itemPath, item, field.model)
      walk(field.model, itemPath, item)
    }
  }

  walk(root, `/${name}/:rootId`, [])
}
