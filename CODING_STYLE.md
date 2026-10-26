# Coding style

How Hedra's code is written. `bun run check` enforces what tooling can; this file covers the rest.

## Stack

Hedra is TypeScript on Bun, with Hono for HTTP, Zod for models and validation, Pino for logging and `bun:test` for tests.

- Prefer Bun's built-ins to a new dependency. Add a dependency only when it removes more complexity than it brings, and justify it in the plan.
- Use no cloud-specific runtime APIs; everything runs in a plain Bun process.

## Formatting and imports

Biome, configured in `biome.json`, owns formatting, import order and lint. Run `bun run fmt` rather than formatting by hand.

## Types and validation

Zod schemas are the single source of truth for types and validation.

- Define the schema, then derive the type from it. Give both the same name. Never hand-write a type for a shape a schema describes.
- Derive variants from the model schema (`.pick`, `.omit`, `.partial`, `.extend`) rather than declaring parallel ones.
- Parse at every trust boundary: request input, environment, configuration, stored data and output from untrusted code. Use the parsed value from then on.

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

- Routes parse requests and shape responses, controllers decide, datastores persist. Controllers work without HTTP.
- Expose the public interface through deliberate exports from the package entry point; everything else is internal.
- Import shared modules through their public exports, and nearby modules by relative path.
- Keep files cohesive, around 100–300 lines. Extend an established area before adding a new one.

## Readability

- Prefer straightforward control flow. Separate logical steps with blank lines, and name intermediate values when it clarifies intent.
- Give every named function and method a doc comment saying what it does. Other comments explain intent, constraints or surprising decisions, in complete sentences.
- Log through Pino, never `console`, and never log secrets or tenant data.

## Tests

- Write tests first for every behaviour change, with the `tdd` skill. Confirm a new test fails for the intended reason before making it pass.
- Test at public seams (routes through `app.request`, controllers through their exports), never internals.
- Name each test for the behaviour it specifies, such as `GET /health returns ok`, and cover failure paths as well as success.
