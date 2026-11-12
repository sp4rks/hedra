// Start a Hedra HTTP app with a single route and its default configuration.
// Running this file with Bun serves the app without separate server setup.

import { Hedra } from '#hedra.ts'

// Load settings from the environment and Bun's .env files; --env-file selects another file.
// HEDRA_SERVER_LISTEN_IP defaults to 0.0.0.0 and HEDRA_SERVER_LISTEN_PORT defaults to 3000.
const hedra = new Hedra()

// Return a plain-text response at the root URL.
hedra.get('/', (context) => context.text('Hello Hedra!'))

// Bun serves the exported app when this file is run directly.
// See docs/configuration.md and docs/logging.md for more settings.
export default hedra
