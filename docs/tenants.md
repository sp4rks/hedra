# Tenant API

Every Hedra app exposes its configuration catalogue at `/tenants`. No application collection registration is required. A tenant has a required `name`, an immutable `tenantDomain`, and the standard server-managed UUID and timestamps. See the [configuration datastore](config-store.md) for its schema and programmatic operations.

## Use the Bruno collection

Open the repository's [bruno directory](../bruno/) as a collection in Bruno and select the `Local` environment. Point it at a running Hedra deployment API by setting:

| Variable | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `http://127.0.0.1:3000` | Server URL, without a trailing slash. |
| `deploymentApiDomain` | `deployment.hedra.local` | The required `Host` header, matching `HEDRA_DEPLOYMENT_API_DOMAIN`. |
| `tenantDomain` | `acme.hedra.local` | Tenant domain for creation and filtering. Must be directly below the deployment domain. |
| `tenantId` | Empty | Existing tenant UUID for retrieval, renaming or deletion. |

Send the request you need: **Create tenant**, **Get tenant**, **List tenants**, **Filter tenants**, **Rename tenant** or **Delete tenant**. Edit the request body or query parameters before sending. These are manual API calls; there is no collection-wide run order or automatic cleanup.

Set `tenantId` to work with an existing tenant. A successful **Create tenant** remembers its returned ID as a runtime `tenantId` for follow-up calls. Runtime variables override environment values, so replace or clear the captured runtime ID before selecting a different tenant through the environment. `tenantDomain` remains the value you choose for creation or filtering.

## Create and rename a tenant

From the repository root with Bun and the project's dependencies installed:

```sh
bun run examples/07-tenants.ts
```

The example creates an in-memory Hedra app, creates `acme.hedra.local`, retrieves and filters the catalogue, changes its name and deletes it. It uses `app.request`, opens no listener and leaves no database file.

For an app running locally on port 3000 with the default deployment settings:

```sh
curl http://localhost:3000/tenants \
  -H 'Host: deployment.hedra.local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme","tenantDomain":"acme.hedra.local"}'
```

Expect `201 Created`, a `Location` header and the new tenant in `data`. Save its `id`, then rename it with:

```sh
curl -X PATCH http://localhost:3000/tenants/TENANT_ID \
  -H 'Host: deployment.hedra.local' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Australia"}'
```

Replace `TENANT_ID` with the returned UUID. Expect `200 OK`; the domain, ID and creation time stay fixed, and `updatedAt` is refreshed.

## Routes and responses

| Request | Result |
| --- | --- |
| `POST /tenants` | Create from `name` and `tenantDomain`; 201 with `Location`. |
| `GET /tenants` | List tenants; 200. Supports the existing JSON `filter` parameter. |
| `GET /tenants/:id` | Retrieve one tenant; 200, or 404 when absent. |
| `PATCH /tenants/:id` | Change the name; 200, or 404 when absent. |
| `DELETE /tenants/:id` | Delete the definition; 204, or 404 when absent. |

Single-resource responses contain `{ data: tenant, links: { self: url } }`; lists contain an array in `data`. Errors use the existing `{ errors: [...] }` envelope. JSON bodies, managed metadata, UUID validation and client/internal error handling follow the [generated REST contracts](web-layer.md#requests-and-responses).

For example, select one tenant domain by URL-encoding `{"tenantDomain":"acme.hedra.local"}` as `filter`. Only declared public fields with scalar values are accepted; pagination and sorting are unavailable.

## Domain rules

`HEDRA_DEPLOYMENT_DOMAIN` defaults to `hedra.local`. A new tenant domain must have exactly one label below it: `acme.hedra.local` is valid; `hedra.local`, `dev.acme.hedra.local` and `acme.other.local` are not. Configured deployment API and docs hostnames are reserved. Names must be nonempty after trimming. Domain values are trimmed, lowercased and validated as DNS names; URLs, ports and wildcard domains are invalid.

Domains are unique. A duplicate create returns 409; deleting a tenant frees its domain for a new tenant with a new ID. PATCH rejects any `tenantDomain` field with 422, even if the value is unchanged. Invalid changes leave the stored tenant untouched. Programmatic replacement can retain the existing domain but cannot change it.

The exported `Tenant` schema checks DNS syntax independently of an app's settings. The controller additionally checks the configured deployment domain, so two apps can use different deployment roots without changing a global validator. See [deployment settings](configuration.md#settings).

## Host and storage boundaries

Every tenant controller operation requires a `Host` header matching `config.deploymentApiDomain` (default `deployment.hedra.local`). Comparison ignores case and a valid optional port. Missing, malformed and different hosts return 412 before configuration storage is accessed. Forwarded-host headers do not select the deployment host. In-process `app.request` callers must supply `Host` explicitly.

The hostname check selects the management API; it does not authenticate or authorise the caller. Apply access controls at ingress or in an outer app before forwarding requests to Hedra. Built-in routes are registered during construction, so middleware added later with `hedra.use(...)` does not wrap them. Tenant definitions do not yet select request tenants or isolate application records. Deleting a definition does not delete application data.

The routes use `app.configDatastore.tenants`, including an injected structural datastore, and never select the application backend for tenant persistence. Construction and unrelated requests leave the default configuration database unopened. An accepted tenant operation opens it on demand; `app.close()` closes an owned store and rejects subsequent tenant HTTP operations. Injected datastores remain usable by their owner. See [storage ownership](config-store.md#configure-storage-and-ownership).

The exported `TenantController` implements `ControllerInterface`. Its constructor accepts `(config, datastoreProvider)`, where `datastoreProvider` returns a `ConfigDatastore` when an operation needs it. Hedra wires this controller automatically; direct controller callers use the same context and collection arguments as the [other REST controllers](collections.md#rest-operations).

`tenants` is a reserved application collection name, including when reached through associations. The internal storage table remains `hedra_config_tenants`.

## Existing tenant definitions

Name-only definitions need an explicitly assigned valid, unique `tenantDomain`. The default store validates complete Tenant values on both programmatic `get`/`list` and HTTP reads. Back up existing data and correct invalid rows before reading them; a definition missing its domain raises an output-validation error, and a list containing it fails as a whole. HTTP responses redact these failures as a generic 500. No migration invents domains or repairs stored definitions. See [read validation](config-store.md#programmatic-operations).
