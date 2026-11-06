# Storage backends

The `Backend` interface persists generic JSON records in named tables. Controllers accept typed data and explicitly protect sensitive fields; callers run resource-model validators when needed. A backend knows a string primary-key ID and JSON data, with no resource-specific schema or UUID generation.

## Operations

All operations return promises. Storage data and filter types derive from the generic storage schemas; concrete resource types remain the responsibility of the controller.

| Method | Behaviour | Result |
| --- | --- | --- |
| `insert(table, record)` | Insert a JSON record containing a string ID. Reject an existing primary key without replacement. | `void` |
| `select(table, filter?)` | Select all records matching every scalar equality criterion. Omit the filter for all records. | Records in insertion order. |
| `update(table, id, modify)` | Run a synchronous modification function against one current record inside a transaction, validate generic storage data, then persist it. | Updated record, or `null`. |
| `delete(table, id)` | Delete one record from the selected table. | `true` when deleted, otherwise `false`. |

Tables have independent primary keys. Table names use the collection-name grammar and are validated before interpolation as quoted SQL identifiers. IDs, filter values and resource data use bound parameters. Invalid JSON and unsupported filter values reject without altering stored resources.

An update modifier receives the current generic record and returns its replacement. It may not change the primary key. The modifier is not invoked when the ID is absent. A thrown error, invalid output or failed write aborts the transaction. This allows a controller to apply its explicit guards and business rules between reading and writing while keeping the backend model agnostic; it does not imply resource-model parsing.

There are no bulk mutation, pagination, schema-migration or model-specific operations. SQLite storage errors propagate in their native form; applications decide how to handle or present them.

## SQLite storage

`new SqliteBackend(path)` opens one Bun SQLite database. Each requested table is created lazily with generic `id` and JSON `data` columns; resource attributes do not become individual SQL columns. A collection named `cars` uses a literal `cars` table.

A file path is relative to the working directory unless absolute. Missing parent directories are created. Use `:memory:` for an isolated database that disappears on close. Separately constructed in-memory backends do not share records; separately constructed file-backed instances open their own connections to the supplied file.

File-backed data survives closing and reopening the backend. For a container, supply a path such as `/data/hedra.sqlite` and mount a persistent volume at `/data`. Persist the containing directory so SQLite's accompanying files stay with the database.

The backend receives its path explicitly. `Hedra` uses the resolved `HEDRA_SQLITE_PATH` setting when creating its default backend; see [server configuration](configuration.md). Legacy table layouts are not migrated or imported.

## Connection ownership

`new Hedra()` opens an app-owned default SQLite backend on the first collection registration. `hedra.close()` closes it and ends its registered controllers' lifecycle.

An injected backend is borrowed. Sharing one instance permits configuration and application resources to use the same connection:

```ts
import { ConfigStore, Hedra, SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const config = new ConfigStore(backend)
const app = new Hedra({ backend })

try {
  const tenant = await config.tenants.create({ name: 'Acme' })

  app.close()
  await config.tenants.get(tenant.id)
} finally {
  app.close()
  backend.close()
}
```

Await outstanding work before closing the shared backend. App closure invalidates its controllers, including saved references, without closing a borrowed backend still used elsewhere. `ConfigStore` has no connection lifecycle methods. The creator closes the concrete backend once all users finish. See the [controller data contract](adr/0008-controller-data-contracts.md).
