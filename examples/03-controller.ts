// Give a controller configuration and logging without tying its methods to HTTP.
// The same controller can be used by a route, a background job or another application component.

import type { Config, LoggerInterface } from '#hedra.ts'
import { Hedra } from '#hedra.ts'

/** Reads application information using dependencies supplied at construction. */
export class EnvironmentController {
  /** Receives configuration and logging without depending on the HTTP app. */
  constructor(
    private readonly config: Config,
    private readonly log: LoggerInterface,
  ) {}

  /** Reports the configured environment and logs through the supplied logger. */
  show() {
    this.log.info('Read application environment')

    return { environment: this.config.serverEnv }
  }
}

// Supply the app's configuration and logger once, when constructing the controller.
const hedra = new Hedra()
const controller = new EnvironmentController(hedra.config, hedra.log)

// Adapt the controller's plain return value into an HTTP JSON response.
hedra.get('/', (context) => context.json(controller.show()))

// Bun serves the exported app when this file is run directly.
export default hedra
