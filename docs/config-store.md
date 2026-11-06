# Configuration store

`ConfigStore` creates tenant definitions through a supplied storage backend. The initial backend is SQLite. Each tenant has a caller-supplied ID and name.

This store persists tenant configuration. Hedra's process settings and `Hedra.config` remain the responsibility of [server configuration](configuration.md).

## Create a tenant

From the repository root, with Bun and the project's dependencies installed, use the public exports:

```ts
import { ConfigStore, SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const config = new ConfigStore(backend)

try {
  const tenant = await config.tenants.create({
    id: ' acme ',
    name: ' Acme ',
  })

  // tenant is { id: 'acme', name: 'Acme' }.
} finally {
  backend.close()
}
```

`tenants.create` returns a promise for the parsed tenant after insertion succeeds. `ConfigStore` validates input before asking the backend to persist it. It returns normalised values and removes properties outside the model.

| Field | Type | Validation |
| --- | --- | --- |
| `id` | `string` | Required, trimmed and nonempty. Unique across tenants in this backend's database. |
| `name` | `string` | Required, trimmed and nonempty. |

`Tenant` is exported as both a Zod schema and its inferred TypeScript type. Callers supply IDs; the store adds no generated IDs, defaults or timestamps.

The [standalone example](../examples/04-config-store.ts) checks the returned tenant and closes the backend. Run it without starting an HTTP server:

```sh
bun run examples/04-config-store.ts
```

It uses an in-memory database and should exit successfully without output or a database file.

## Storage and connection ownership

`new SqliteBackend(path)` opens one database and prepares configuration storage. A file path is relative to the working directory unless absolute; missing parent directories are created. Use `:memory:` for an isolated database that disappears when closed.

For persistence, supply a file path such as `.runtime/config.sqlite`. Close the backend and construct a new backend with the same path to reopen its records. In a container, persist the containing directory through a volume so SQLite's accompanying files stay with the database.

Multiple `ConfigStore` instances can receive the same backend. They share its connection and tenant catalogue; independently constructed in-memory backends have separate catalogues. A new backend instance opens its own connection even when it uses the same file path.

The caller that creates the backend controls its lifetime. Await outstanding operations before calling `backend.close()`. Closing preserves file-backed data and ends access through every store using that backend. `ConfigStore` has no connection lifecycle methods. See the [connection ownership decision](adr/0006-backend-owned-datastore-connections.md).

Construction is explicit. The store does not read `HEDRA_SQLITE_PATH`, attach itself to a `Hedra` instance, or share the existing collection connection automatically. Supplying a path through application startup keeps those choices visible.

## Errors and backend contract

Invalid input rejects with a Zod validation error before anything is inserted. A duplicate normalised ID rejects without replacing its existing record. Storage failures, including duplicates and operations after closure, propagate as native SQLite errors; construction with an unusable path throws. Store operations do not return HTTP responses or terminate the process.

The narrow backend contract is `ConfigBackend.insertTenant(tenant: Tenant): Promise<void>`. It receives the tenant already parsed by `ConfigStore`, inserts it once, and rejects an existing ID. SQLite implements it with bound SQL parameters. Backends own their connections, while category classes depend only on the storage operations they require.

This increment provides tenant creation only. Reads, updates, deletion, environment definitions and operations, and other backends are deferred. Creating a tenant definition does not add tenant isolation to existing [application collections](collections.md).
