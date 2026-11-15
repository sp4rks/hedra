import type { z } from 'zod'

import type { ChildTarget, ControllerInterface } from '#controllers'
import { InputValidationError } from '#errors'
import { childInput, ResourceId, resourceName, safeChildKey, setResourceScope } from '#models'
import { body, input } from '#web/resources.ts'
import { response, routeHandler } from '#web/responses.ts'

export type ChildAddress = { field: string; kind: 'array' | 'dictionary' | 'single' | 'object'; parameter?: string }

/** Handles one nested operation against a complete containing-root snapshot. */
export function childHandler(
  root: z.ZodObject,
  controller: ControllerInterface,
  output: z.ZodObject,
  method: 'get' | 'post' | 'patch' | 'delete',
  steps: ChildAddress[],
  model: z.ZodObject,
  list = false,
) {
  const name = resourceName(root)

  return routeHandler(async (context) => {
    try {
      decodeURIComponent(new URL(context.req.url).pathname)
    } catch {
      throw new InputValidationError('Invalid child URI encoding')
    }
    const rootId = input(ResourceId, context.req.param('rootId'))
    const target: ChildTarget = {
      kind: 'child',
      rootId,
      steps: steps.map((step) => ({
        field: step.field,
        selector:
          step.kind === 'single' || step.kind === 'object'
            ? { kind: step.kind }
            : step.kind === 'array'
              ? {
                  kind: 'array',
                  ...(step.parameter ? { id: input(ResourceId, context.req.param(step.parameter)) } : {}),
                }
              : {
                  kind: 'dictionary',
                  ...(step.parameter ? { key: safeChildKey(context.req.param(step.parameter) ?? '') } : {}),
                },
      })),
    }

    setResourceScope(context, { collection: name, target })
    if (new URL(context.req.url).search) throw new InputValidationError('Child queries are not supported')
    if (method === 'delete') {
      const snapshot = await controller.id(context, root, rootId)

      response(output, snapshot, { child: { model: root, target, url: context.req.url } })
      await controller.delete(context, root, rootId)

      return context.body(null, 204)
    }
    let result: unknown

    if (method === 'get')
      result = list ? await controller.list(context, root, context.req.url) : await controller.id(context, root, rootId)
    else {
      const value = await body(
        context,
        childInput(model, method === 'patch'),
        method === 'patch',
        'environmentDomain',
        model,
      )

      result =
        method === 'post'
          ? await controller.create(context, root, value as never)
          : await controller.update(context, root, value as never, rootId)
    }
    const validated = response(output, result, {
      list,
      writeSucceeded: method !== 'get',
      child: { model: root, target, create: method === 'post', url: context.req.url },
    })

    if (method === 'post') context.header('Location', validated.links.self)

    return context.json(validated, method === 'post' ? 201 : 200)
  })
}
