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
- Derive variants from the model schema (`.pick`, `.omit`, `.partial`, `.extend`) rather than declaring parallel ones. Mutation types describe allowed fields and retain runtime validation.
- Parse application data at every trust boundary: request input, environment, configuration, stored data and application data returned by untrusted code. Use the parsed value from then on.
- Domain-aware operations validate complete domain values they return, including stored reads and injected results, and return parsed values. Generic backends validate their storage contracts; domain operations own domain invariants.

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

- Routes validate public input and handle HTTP transport. REST controllers implement resource actions, protect server-owned fields and shape resource responses. Programmatic datastore operations stay independent of HTTP; generic backends own persistence and transactions.
- Name every file for what it holds, never `index.ts`, so open tabs stay distinguishable. A module that grows into its own directory names its main file after the directory, as in `tenancy/tenancy.ts`.
- Expose the public interface through deliberate exports from `src/hedra.ts`, the package entry point; everything else is internal. The internal models entry point, `src/models/models.ts`, is the exception to avoiding barrel files that only re-export.
- Import Hedra modules through a `#` alias from `src/` and from `tests/`, including within the same area. A `#` path maps to `src/`. Config is `#config` and `#config/*`. Errors are `#errors`.
- Outside `src/models/`, use the deliberate exports from `#models` when combining model imports shortens the formatted import block. Within `src/models/`, import concrete model modules to keep dependencies acyclic. Single-module consumers may keep their direct imports.
- Keep files cohesive, around 100–300 lines. Extend an established area before adding a new one.

## Readability

- Prioritise readability, then conciseness. Use names that reveal what values contain. Prefer straightforward control flow, separate logical steps with blank lines and name intermediate values when it clarifies intent.
- Give named functions and methods, including nested helpers, a purpose comment. Explain non-obvious ordering, ownership, lifecycle and synchronous/asynchronous constraints where relevant, in complete sentences. Keep comments on straightforward functions brief.
- Log through Hedra's `LoggerInterface`, never `console`, and never log secrets or tenant data. Pino is the default adapter.

## Tests

- Write tests first for every behaviour change, with the `tdd` skill. Confirm a new test fails for the intended reason before making it pass.
- Test at public seams (routes through `app.request`, controllers through their exports), never internals.
- Name each test for the behaviour it specifies, such as `GET /health returns ok`, and cover failure paths as well as success.
- Use real local dependencies such as in-memory SQLite when practical. Where relevant, type-check forbidden fields in pretyped values as well as object literals.

`bun run test:coverage` runs the full suite and requires at least 90% line coverage and 85% function coverage in each reported file. `bun run check` includes this gate. Plain `bun test` and `bun run test` keep coverage disabled for focused runs. Coverage supports behaviour and failure-path tests; it does not prove contract correctness.

Coverage settings live in `bunfig.toml`. The report appears in the terminal and in the gitignored `coverage/lcov.info` file. Tests, examples and tooling scripts are excluded. [Bun's coverage](https://bun.com/docs/test/code-coverage) measures modules loaded in the test process; unimported source files and execution in spawned processes do not contribute.
