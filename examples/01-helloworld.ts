import { Hedra } from '#hedra.ts'

// Set HEDRA_SERVER_LISTEN_IP (IPv4 or IPv6, default 0.0.0.0) and
// HEDRA_SERVER_LISTEN_PORT (1–65535, default 3000) in the environment or .env.
// HEDRA_SERVER_LISTEN_PORT replaces HEDRA_SERVER_PORT.
const hedra = new Hedra()
hedra.get('/', (context) => context.text('Hello Hedra!'))

export default hedra
