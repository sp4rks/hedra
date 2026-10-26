# Hedra

Hedra derives a tenant-aware backend from consumer-defined Zod models. It runs on Bun, Hono, SQLite and Pino,
with shared controllers for generated JSON:API routes and direct programmatic operations.

Phase 1 is a **development milestone without authentication or access control**. Hostnames select data scope;
they do not authenticate callers. Authski remains a future consumer, with no built-in Application entity in Hedra.

## Run the examples

Use Bun 1.4.3:

```sh
bun install --frozen-lockfile
bun run check
bun test
bun run examples/01-helloworld.ts
```

Each example runs independently and adds a concept:

| Example | Demonstrates |
| --- | --- |
| [01-helloworld.ts](examples/01-helloworld.ts) | Native Hono route and Bun default-export startup |
| [02-model-crud.ts](examples/02-model-crud.ts) | One model, parsed values, SQLite CRUD and documentation |
| [03-tenancy.ts](examples/03-tenancy.ts) | Two tenants, sibling environments and scoped uniqueness |
| [04-related-resources.ts](examples/04-related-resources.ts) | Owned children, sensitive fields and explicit cascade |
| [05-custom-controller.ts](examples/05-custom-controller.ts) | Shared overrides, subclassing and native scoped routes |

Every example exports its app as the default. Running the file lets Bun start the listener on all interfaces at port 3000;
`PORT` selects another port. For example:

```sh
PORT=3001 bun run examples/02-model-crud.ts
curl --fail http://localhost:3001/hello
```

Example 01 opens no database. Examples 02–05 explicitly initialise Hedra and seed disposable in-memory databases before
exporting their apps. Importing those examples runs their setup, with no listener started by the import. They require fresh
storage when selecting a file through `HEDRA_DATABASE`. Each adds its own concept to the same `/hello` baseline.

Bun owns the listener and process termination. For explicit listener configuration and graceful shutdown, see
[lifecycle configuration](docs/configuration.md#lifecycle).

With example 05 running:

```sh
curl --fail http://127.0.0.1:3000/health
curl --fail -H 'Host: docs.hedra.local:3000' http://127.0.0.1:3000/openapi.json
curl --fail -H 'Host: dev.acme.hedra.local:3000' http://127.0.0.1:3000/applications
```

The on-demand [Docker/Caddy preview](docs/preview.md) serves the browser reference without editing local hostname mappings.
Its Smoke containers are removed; the definition and recovery packages are retained.
The generated reference uses Scalar's CDN; the OpenAPI JSON works without it.

## Use Hedra in another Bun project

Consume the sibling repository through `"hedra": "file:../hedra"` and run `bun install`. Consumers import the public
package entry point; private package aliases resolve without copying Hedra's TypeScript configuration.
The dependency versions in [package.json](package.json) and [bun.lock](bun.lock) define the tested integrated stack.

```ts
import { Collection, Hedra, Resource, z } from 'hedra'

const Widget = Resource.extend({ name: z.string().trim().min(1) })
const app = new Hedra()
const widgets = app.register(new Collection({ collectionName: 'widgets', schema: Widget }))

app.get('/health', context => context.json({ status: 'ok' }))
await app.initialize()

export default app
```

Provision tenants/environments through their built-in collections before operating on consumer records.
[Framework contracts](docs/contracts.md) describe scope, controller replacement, supported schemas and output types.
[Configuration](docs/configuration.md) lists the environment variables and defaults.
[Errors](docs/contracts.md#errors) documents the named error classes and automatic JSON:API error responses.

## Verification and limits

`bun run check` typechecks the package, examples and tests, and checks formatting/import order. `bun test` includes real
SQLite integration, separate-consumer typechecking, independent examples and CLI startup/shutdown on ephemeral
ports. `bun run test:coverage` reports coverage; subprocess entrypoint execution is verified separately from its counters.

Automatic migrations, pattern matching, advanced JSON:API features, actual Authski migration, package publication,
Cloudflare integration and public production deployment are deferred. Sensitive metadata controls public exposure;
applications still own hashing/encryption and the safety of arbitrary native handlers.

The agreed scope is recorded in [phase 1](docs/phase-1.md).
