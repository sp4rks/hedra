# Configuration datastore dependency

## Behaviour and scope

Hedra accepts a configuration datastore by responsibility, hiding its storage implementation. Add `configDatastore?: ConfigDatastore` to `HedraOptions` and expose the stable instance through `app.configDatastore`. The contract starts with the existing tenant create/get/list/update/replace/delete operations. It does not expose a backend, connection, table name or lifecycle method, and must accept structural implementations without inheriting a class.

Retain the existing application `backend` option, collection registration, associations and controller lifecycle. That dependency currently persists application collections, so replacing it with a configuration datastore would misroute application data. Other datastore roles, backend engines, routing, tenant isolation and cross-datastore transactions are outside this change.

## Interface and implementation

- Define and export a plain `ConfigDatastore` interface in `src/datastores/categories/config/config.ts`; its readonly `tenants` member derives the six public operation signatures from `ResourceOperations<Tenant>` using `Pick`. This avoids coupling the contract to that class's protected backend, private helpers or public table name.
- Keep `ConfigStore` as the default implementation and declare that it implements `ConfigDatastore`. Change its constructor to `new ConfigStore(options?: ConfigStoreOptions)`, with optional `config?: Config` and `backend?: Backend`. Export both the interface and options type through `src/hedra.ts`.
- A supplied backend is used directly. Otherwise, `ConfigStore` creates a SQLite backend using `(options.config ?? new Config()).sqlitePath`. Backend selection and connection construction remain inside the datastore module, with no new configuration flags, dependency or factory registry. Preserve the existing `HEDRA_SQLITE_PATH`, table name and persisted record format.
- `ConfigStore.close()` idempotently closes only the backend it creates. Closing a store backed by an injected backend has no effect on that backend or its operations. Its creator retains responsibility for shared connection lifetime. Await operations before closing.
- Hedra retains a supplied datastore instance unchanged and never closes it, including implementations that happen to offer `close()`. A datastore injected without a lifecycle method is valid.
- Hedra creates its default `ConfigStore` only on the first `app.configDatastore` access, passing its loaded Config. Cache that instance and a concrete closer, and close it from `app.close()`. Constructor calls, collection registration and app closure before datastore access must not construct configuration storage. Reject datastore access after app closure without opening storage. If default construction fails, leave it uncached and propagate the error.
- No per-operation guard or generic proxy is needed for this increment: saved operations from an owned store reject through its closed backend; saved operations from an injected store remain the injector's responsibility.

The default configuration store and application backend use independent connections to the configured path. With `:memory:`, those connections contain independent data. Sharing a connection is explicit: construct `new ConfigStore({ backend })` and supply it alongside the same application backend. This preserves backend ownership and existing application transactions while making configuration construction local to its implementation. Record this extension to ADR-0009 in ADR-0019 and define configuration datastore terminology in the glossary.

## Structure and ownership

Extend existing files; add no implementation directory:

```text
src/datastores/categories/config/config.ts  datastore contract, options, default implementation and connection ownership
src/server/server.ts                       injection, lazy default construction and owned lifecycle
src/hedra.ts                               deliberate public exports
tests/datastores/categories/config/        default datastore persistence and backend ownership
tests/server/                             injection, configuration and application lifecycle
docs/config-store.md                       primary datastore usage and contract reference
docs/configuration.md                      constructor option reference
docs/backends.md                           shared backend ownership
docs/adr/0019-config-datastore.md           architectural decision
examples/04-config-store.ts                standalone executable example
```

The coder owns production code and tests, including every test caller affected by the ConfigStore constructor change. The lead owns this plan, GLOSSARY.md and docs/examples. Implementation and documentation run in separate worktrees; the coder must not edit docs/examples. The lead merges the docs branch into the feature branch before acceptance and review. Do not merge main without the user's approval.

## Test design and acceptance

The lead accepts the public `new Hedra(options)`, `app.configDatastore`, `app.close()`, exported type contracts, `new ConfigStore(options)` and tenant operation seams. Use real SQLite backends and isolated temporary paths; never inspect private fields or mock datastore construction. Retain existing tenant CRUD, managed-field, backend sharing, reserved-name, collection and association coverage. The existing tests catch application regressions; these tests establish the configuration dependency and its ownership.

Implement one failing test and its passing change at a time:

1. **Hedra accepts a structural configuration datastore and preserves its identity.** Supply an object satisfying the contract, exercise tenant operations through `app.configDatastore`, and verify no default storage is opened. The contract must support plain tenant operation implementations without ResourceOperations class inheritance, a table name or backend methods.
2. **Hedra borrows a supplied configuration datastore.** Two apps may share it; closing one app does not call an optional concrete close method or prevent the other app/direct caller using it. Include a valid implementation with no close method.
3. **Hedra creates configuration storage only when requested.** Use a temporary nested database path: construction and close-before-access leave it absent; first access creates it, returns the same datastore on repeated access, and permits creating/retrieving a tenant.
4. **Hedra closes its default configuration datastore and retains persisted tenants.** Save the tenant operations, close the app twice, verify saved operations reject and access through the closed app rejects; a new app at the same path retrieves the tenant. Access after closure before first use must not create the file.
5. **A failed default configuration datastore open propagates without poisoning later access.** An unusable path throws at first access; after correcting the filesystem, the same app can construct the datastore and use tenant operations. Tests use the public getter and filesystem setup only.
6. **ConfigStore uses its supplied Config for SQLite persistence.** Standalone construction with `{ config }`, create and close, then reopen with the same config and retrieve the tenant. This test verifies configuration is interpreted by the datastore itself.
7. **ConfigStore borrows an injected backend.** Two stores and an app can share it; closing a store twice does not close the backend or stop another user. An injected backend takes precedence over an unusable configured SQLite path.
8. **Hedra keeps configuration storage separate from its application backend.** Use two real backends with explicit shared stores to prove tenant operations use the supplied datastore while application routes/associations keep using the supplied application backend; retain existing shared-backend compatibility coverage.

Run `bun run check` and every executable example in an isolated environment with temporary database paths. Update docs to explain construction, configuration, ownership, structural implementations, the `{ backend }` constructor migration, and the separate application backend. Independently review the fixed implementation and docs commit range using the reviewer skill; fix confirmed issues through the same coder and rerun affected checks. Main integration requires user approval.
