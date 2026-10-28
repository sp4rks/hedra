# 1. Hello Hedra

You start with an empty app. By the end of this chapter, a Hedra app answers HTTP requests on port 3000.

You need [Bun](https://bun.sh) and a checkout of the Hedra repository. Run `bun install` once in the repository root, and run every command in this tutorial from there.

## Write the app

The app for this chapter is `examples/tutorial/01-hello-hedra.ts`:

```ts
import { Hedra } from '#hedra.ts'

const hedra = new Hedra()
hedra.get('/', (context) => context.text('Hello Hedra!'))

export default hedra
```

Inside the repository, `#hedra.ts` is Hedra's package entry point. In your own app, the same import is `from 'hedra'`.

## Run it

```sh
bun run examples/tutorial/01-hello-hedra.ts
```

Hedra prints a table of its settings, each with the source of its value. Every setting comes from its default for now. The last line says the app is serving:

```text
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

Stop the app with Ctrl+C.

## What you learned

`new Hedra()` creates a Hedra **app**. It reads its settings from `HEDRA_*` environment variables, prints them, and adds `GET /health`. A Hedra app is a [Hono](https://hono.dev) app, so `hedra.get` adds a route the way it does in Hono.

Exporting the app as the module's default lets Bun serve it. The port comes from `HEDRA_SERVER_PORT`, which defaults to 3000.

Next: [2. Accept tenants](02-tenants.md)
