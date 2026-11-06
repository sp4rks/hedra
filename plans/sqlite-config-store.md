# SQLite configuration store

## Agreed scope

Implement the configuration-store design reviewed in chat: `ConfigStore` receives a backend through its constructor, validates tenant configuration, and exposes `tenants.create`. The initial backend is SQLite. The initial `Tenant` model has caller-supplied `id` and `name` strings, both trimmed and required to be nonempty.

Keep application operations named for the caller's intent and backend operations named for persistence: `config.tenants.create(tenant)` calls `backend.insertTenant(tenant)`. Creation rejects an existing normalized ID without replacing its record.

## Interface and ownership

- `Tenant` is a Zod object schema and an inferred type with the same name. Parsing supplies the stored and returned record; unknown keys follow Zod's normal object behaviour.
- `ConfigBackend.insertTenant(tenant: Tenant): Promise<void>` is the only backend capability required by `ConfigStore`.
- `ConfigStore.tenants.create(input: Tenant): Promise<Tenant>` parses input before calling the backend and returns the parsed tenant after insertion succeeds.
- `SqliteBackend(path: string)` owns one Bun SQLite `Database`, creates a file's parent directories when necessary, and prepares `hedra_config_tenants` with a non-null primary-key ID and JSON record data. It supports `:memory:`.
- Backend insertion uses bound SQL parameters. A plain `INSERT` enforces duplicate rejection; native SQLite errors and validation failures propagate to the caller.
- `SqliteBackend.close(): void` releases the connection. Application startup owns the backend's lifetime and closes it after all users finish. `ConfigStore` neither opens nor closes connections; multiple config stores can use one backend.
- Export `Tenant`, `ConfigStore`, `SqliteBackend`, and the `ConfigBackend` type deliberately through `src/hedra.ts`.

## Structure

```text
src/
  models/tenant.ts
  datastores/categories/config/config.ts
  datastores/backends/sqlite/sqlite.ts
  hedra.ts
tests/
  datastores/categories/config/config.test.ts
docs/
  config-store.md
  adr/0006-backend-owned-datastore-connections.md
examples/
  04-config-store.ts
```

The existing collection SQLite module and `Hedra.config` bootstrap configuration remain as they are. Construction is explicit; this feature adds no server options, automatic startup wiring, HTTP routes, client registry, or dependency.

## Acceptance and test design

The user approved implementation following the reviewed draft and its temporary checks. Use TDD at the public seams `ConfigStore.tenants.create`, `SqliteBackend` construction, and `SqliteBackend.close`, importing the public exports. Prefer real temporary SQLite databases. Do not inspect private fields or query implementation tables to prove behaviour.

| Named behaviour | Public seam and evidence |
| --- | --- |
| `ConfigStore creates a tenant from normalized configuration` | Creation returns literal trimmed `id` and `name` values using an in-memory backend. |
| `ConfigStore rejects invalid tenant configuration before writing` | Invalid input rejects; a subsequent valid creation with the same ID succeeds. Cover missing, blank, and incorrectly typed required fields. |
| `ConfigStore rejects an existing normalized tenant ID` | Create a tenant, then reject creation with the same normalized ID. A different ID still succeeds. |
| `ConfigStore shares tenant storage through one backend` | Two store instances using one backend observe duplicate-ID protection across stores. |
| `SqliteBackend persists tenants after reopening a nested database path` | Create, close, reopen, and reject the same ID through a new config store; another ID succeeds. This also exercises parent-directory creation. |
| `SqliteBackend gives separate in-memory backends independent storage` | The same tenant ID can be created independently in two backends. |
| `SqliteBackend rejects an unusable database path` | Construction fails for a path that is a directory. |
| `SqliteBackend.close ends access for every attached config store` | Creating through either store rejects after closing their shared backend. |

Write one failing test, confirm the intended failure, then add the minimum implementation before the next test. Run `bun run check` and the standalone documented example after code and docs are combined. Give an independent read-only reviewer the fixed commit range, this plan, and check results.

## Documentation and integration

Document explicit construction, validation, duplicate rejection, persistence, and ownership. Provide a standalone in-memory example that creates a tenant and closes the backend without starting a server. Keep docs and examples on a separate docs branch while implementation proceeds, then merge them into the feature branch and verify the combined revision.

Finish with the reviewed feature branch ready for the user. Merging into `main` requires the user's approval after review, as required by the repository workflow.

## Deferred work

Tenant reads, updates, deletion, environment models and operations, generated IDs, error normalization across backends, other datastore categories/backends, and application tenancy isolation are outside this increment. This tenant-configuration catalogue does not add tenant isolation to the existing application collections.
