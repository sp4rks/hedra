# Coding style

How Hedra's code is written. `bun run check` enforces what tooling can; this file covers the rest.

## Stack

Hedra is TypeScript on Bun, with Hono for HTTP, Zod for models and validation, Pino for logging and `bun:test` for tests.

- Prefer Bun's built-ins to a new dependency. Add a dependency only when it removes more complexity than it brings, and justify it in the plan.
- Use no cloud-specific runtime APIs; everything runs in a plain Bun process.

## Formatting and imports

Biome, configured in `biome.json`, owns formatting, import order and lint. Run `bun run fmt` rather than formatting by hand.

Its spacing rule reports missing blank lines before returns and loops and after groups of variable declarations. Add those lines manually; `bun run fmt` does not insert them.
Biome and its runtime types are pinned while the plugin API is in developer preview. Run `bun test tests/spacing.test.ts` when upgrading them.

## Types and validation

Use Zod for "in plane" object definitions: models of data the application works with, such as resources, embedded resources, associations, configuration values and request, response or storage data. Their schemas are the single source of truth for types and validation.

Routine options and dependency wiring, such as `HedraOptions`, `LoggerInterface` and `Backend`, use plain TypeScript types or interfaces. They do not need a Zod schema solely to describe their shape. Configuration values and other application data still require validation at their trust boundaries.

- For application models, define the schema, then derive the type from it. Give both the same name. Never hand-write a type for a shape a schema describes.
- Derive variants from the model schema (`.pick`, `.omit`, `.partial`, `.extend`) rather than declaring parallel ones.
- Parse application data at every trust boundary: request input, environment, configuration, stored data and application data returned by untrusted code. Use the parsed value from then on.

```ts
export const Widget = z.object({ id: z.uuid(), name: z.string().trim().min(1) })
export type Widget = z.infer<typeof Widget>

export const NewWidget = Widget.omit({ id: true })
export type NewWidget = z.infer<typeof NewWidget>
```

## Structure

Group code by responsibility, creating directories only as needed:

```text
src/
  routes/       HTTP handling, nested by URL
  controllers/  behaviour and business rules
  models/       Zod schemas and inferred types
  datastores/   storage access
  server/       startup, configuration, logging and middleware
tests/          mirrors src/
```

- Routes validate public input and handle HTTP transport. REST controllers implement resource actions, protect server-owned fields and shape resource responses. Programmatic datastore operations stay independent of HTTP and persist through generic backends.
- Name every file for what it holds, never `index.ts`, so open tabs stay distinguishable. A module that grows into its own directory names its main file after the directory, as in `tenancy/tenancy.ts`.
- Expose the public interface through deliberate exports from `src/hedra.ts`, the package entry point; everything else is internal. Write no barrel files that only re-export.
- Import Hedra modules through a `#` alias from `src/` and from `tests/`, including within the same area. A `#` path maps to `src/`. Config is `#config` and `#config/*`. Errors are `#errors`.
- Keep files cohesive, around 100–300 lines. Extend an established area before adding a new one.

## Readability

- Prefer straightforward control flow. Separate logical steps with blank lines, and name intermediate values when it clarifies intent.
- Give every named function and method a doc comment saying what it does. Other comments explain intent, constraints or surprising decisions, in complete sentences.
- Log through Hedra's `LoggerInterface`, never `console`, and never log secrets or tenant data. Pino is the default adapter.

## Tests

- Write tests first for every behaviour change, with the `tdd` skill. Confirm a new test fails for the intended reason before making it pass.
- Test at public seams (routes through `app.request`, controllers through their exports), never internals.
- Name each test for the behaviour it specifies, such as `GET /health returns ok`, and cover failure paths as well as success.
