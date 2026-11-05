import type { Config, Logger } from '#hedra.ts'
import { Hedra } from '#hedra.ts'

/** Reads application information using dependencies supplied at construction. */
export class EnvironmentController {
  /** Receives configuration and logging without depending on the HTTP app. */
  constructor(
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  /** Reports the configured environment and logs through the supplied logger. */
  show() {
    this.log.info('Read application environment')

    return { environment: this.config.serverEnv }
  }
}

const hedra = new Hedra()
const controller = new EnvironmentController(hedra.config, hedra.log)

// Application startup wires the dependencies once; controller methods use them directly.
hedra.get('/', (context) => context.json(controller.show()))

export default hedra
