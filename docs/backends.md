# Storage backends

The `Backend` interface persists generic JSON records in named tables. REST controllers manage resource metadata and public output; programmatic resource operations serve ConfigStore without HTTP. Callers validate domain input with pure model-derived validators. A backend knows a string primary-key ID and JSON data, with no resource-specific schema, UUID generation or response formatting.

## Operations

All operations return promises. Storage data and filter types derive from the generic storage schemas; resource models stay outside the backend.

| Method | Behaviour | Result |
| --- | --- | --- |
| `insert(table, record)` | Insert a JSON record containing a string ID. Reject an existing primary key without replacement. | `void` |
| `select(table, filter?)` | Select all records matching every scalar equality criterion. Omit the filter for all records. | Records in insertion order. |
| `update(table, id, modify)` | Run a synchronous modification function against one current record inside a transaction, validate generic storage data, then persist it. | Updated record, or `null`. |
| `delete(table, id)` | Delete one record from the selected table. | `true` when deleted, otherwise `false`. |
| `transaction(work)` | Run synchronous storage operations across records/tables and commit them together. | The callback result. |

Tables have independent primary keys. Table names use the collection-name grammar and are validated before interpolation as quoted SQL identifiers. IDs, filter values and resource data use bound parameters. Invalid JSON and unsupported filter values reject without altering stored resources.

An update modifier receives the current generic record and returns its replacement. It may not change the primary key. The modifier is not invoked when the ID is absent. A thrown error, invalid output or failed write aborts the transaction. A controller can run pure candidate validation and business rules between reading and writing; the backend itself remains model agnostic.

There are no bulk mutation, pagination, schema-migration or model-specific operations. SQLite failures are wrapped in [Hedra datastore errors](errors.md#wrapped-failures), with the native error retained as `cause`. Applications decide how to handle or present them.

## Transactions across records

`Backend.transaction` passes a synchronous `BackendTransaction` to its callback. The session has the same insert/select/update/delete operations without promises. A thrown error, invalid record or failed operation rolls back the transaction. SQLite session failures are Hedra errors even when caught inside the callback; an existing Hedra error retains its identity. Do not use an async callback or retain a session after it returns; both reject with Hedra errors. Await the outer transaction promise.

Given an open backend:

```ts
await backend.transaction((transaction) => {
  transaction.insert('projects', { id: 'project-1', title: 'Launch' })
  transaction.insert('notes', { id: 'note-1', text: 'Ready' })
})
```

This is a generic storage example: backend IDs may be arbitrary strings and table names need not describe registered resources. Resource controllers continue to generate UUIDs and audit timestamps. A custom Backend must implement the transaction capability as well as the four ordinary asynchronous operations.

SQLite uses an immediate transaction to protect its reference checks and writes against competing connections. Controllers use it to create associated resources and links together, and to check associations before deleting either endpoint. Embedded edits use an atomic modification of their containing document. See the [transaction decision](adr/0011-backend-owned-multi-record-transactions.md).

## SQLite storage

`new SqliteBackend(path)` opens one Bun SQLite database. Each requested table is created lazily with generic `id` and JSON `data` columns; resource attributes do not become individual SQL columns. A collection named `cars` uses a literal `cars` table. Embedded values remain inside that record's JSON. Links between independent resources use the reserved internal `hedra_associations` table.

A file path is relative to the working directory unless absolute. Missing parent directories are created. Use `:memory:` for an isolated database that disappears on close. Separately constructed in-memory backends do not share records; separately constructed file-backed instances open their own connections to the supplied file.

File-backed data survives closing and reopening the backend. For a container, supply a path such as `/data/hedra.sqlite` and mount a persistent volume at `/data`. Persist the containing directory so SQLite's accompanying files stay with the database.

The backend receives its path explicitly. `Hedra` uses the resolved `HEDRA_SQLITE_PATH` setting when creating its application backend, while `ConfigStore` uses it when creating configuration storage; see [server configuration](configuration.md). Legacy table layouts are not migrated or imported.

## Connection ownership

`new Hedra()` opens an app-owned default SQLite backend on the first collection registration. `hedra.close()` closes it and ends its registered controllers' lifecycle.

The configuration datastore has a separate lifetime. First access to `app.configDatastore` creates the default `ConfigStore`, which opens its own connection to the configured path. App closure closes that owned store too. An injected `configDatastore` is borrowed and remains usable by its creator after app closure; see [configuration datastore ownership](config-store.md#configure-storage-and-ownership).

An injected backend is borrowed. Sharing one instance permits configuration and application resources to use the same connection:

```ts
import { ConfigStore, Hedra, SqliteBackend } from '#hedra.ts'

const backend = new SqliteBackend(':memory:')
const configDatastore = new ConfigStore({ backend })
const app = new Hedra({ backend, configDatastore })

try {
  const tenant = await app.configDatastore.tenants.create({ name: 'Acme' })

  app.close()
  await configDatastore.tenants.get(tenant.id)
} finally {
  app.close()
  backend.close()
}
```

Await outstanding work before closing the shared backend. App closure invalidates its controllers, including saved references, without closing a borrowed backend still used elsewhere. `ConfigStore.close()` closes only a backend that store creates; here it leaves the injected backend open. The creator closes the concrete backend once all users finish. See the [REST controller contract](adr/0009-rest-controller-interface.md).
