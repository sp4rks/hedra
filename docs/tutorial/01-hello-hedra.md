# 1. Hello Hedra

By the end of this chapter, a Hedra app answers HTTP requests on port 3000 and writes a log line for each health check.

You need [Bun](https://bun.sh) and Git. Get the Hedra repository and install its dependencies:

```sh
git clone https://github.com/sp4rks/hedra.git
cd hedra
bun install
```

Run every command in this tutorial from the repository root. Each chapter's app is already a file in `examples/tutorial/`, and each file adds to the one before it. You read the code, then run it.

## Read the app

The app for this chapter is `examples/tutorial/01-hello-hedra.ts`:

```ts
import { Hedra } from '#hedra.ts'

const hedra = new Hedra()
hedra.get('/', (context) => context.text('Hello Hedra!'))

export default hedra
```

`#hedra.ts` is the file `src/hedra.ts`, which exports everything Hedra offers. The `#` is an import alias that the repository's `package.json` defines. This tutorial stays inside the repository, so every example imports from `#hedra.ts`.

## Run it

```sh
bun run examples/tutorial/01-hello-hedra.ts
```

Hedra prints its settings. Every value comes from its default:

```text
Environment Variable                               Value                                              Source
HEDRA_DEPLOYMENT_DOMAIN                            hedra.local                                        default
HEDRA_DEPLOYMENT_API_DOMAIN                        deployment.hedra.local                             default
HEDRA_DEPLOYMENT_DOCS_DOMAIN                       docs.hedra.local                                   default
HEDRA_SERVER_ENV                                   dev                                                default
HEDRA_SERVER_SILENT_STARTUP                        false                                              default
HEDRA_SERVER_LOG_TYPE                              pino                                               default
HEDRA_SERVER_LOG_LEVEL                             info                                               default
HEDRA_SERVER_HTTP_LOGGING                          true                                               default
HEDRA_SERVER_PORT                                  3000                                               default
HEDRA_SERVER_REQUEST_TIMEOUT                       30000                                              default

See src/server/config/categories/ for defaults and descriptions.

Started development server: http://localhost:3000
```

Leave the app running.

## Check your work

In a second terminal, request the page you added:

```sh
curl http://localhost:3000/
```

```text
Hello Hedra!
```

Hedra also serves a health check that you did not write:

```sh
curl http://localhost:3000/health
```

```json
{"ok":true}
```

The first terminal shows a log line for that request. Your `time` and `instanceId` differ:

```json
{"level":30,"time":1793180584949,"instanceId":"23ffb6a8-7175-437a-9682-ce7c2d757ba3","msg":"health check"}
```

Stop the app with Ctrl+C.

## What you learned

`new Hedra()` creates a Hedra **app**. It reads its settings from `HEDRA_*` environment variables, prints them, and adds `GET /health`. It also has a logger that writes JSON lines. A Hedra app is a [Hono](https://hono.dev) app, so `hedra.get` adds a route the way it does in Hono.

Exporting the app as the module's default lets Bun serve it. The port comes from `HEDRA_SERVER_PORT`. The [configuration reference](../reference/configuration.md) lists every setting.

Next: [2. Accept tenants](02-tenants.md)
