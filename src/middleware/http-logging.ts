import type { MiddlewareHandler } from 'hono'
import { routePath } from 'hono/route'

import type { LoggerInterface } from '#server/logger.ts'

/** Logs the completed response after request ID middleware has assigned its correlation ID. */
export function httpLoggingMiddleware(log: LoggerInterface): MiddlewareHandler {
  return async (context, next) => {
    const id = context.get('requestId')
    const start = performance.now()

    await next()

    const fields = {
      requestId: id,
      method: context.req.method,
      path: routePath(context),
      status: context.res.status,
      durationMs: performance.now() - start,
    }

    // A raw Response can bypass Hono's prepared response headers.
    if (context.res.headers.get('X-Request-Id') !== id) context.header('X-Request-Id', id)
    try {
      log.info('HTTP request completed', fields)
    } catch {
      // Preserve the completed HTTP response if the log write fails.
    }
  }
}
