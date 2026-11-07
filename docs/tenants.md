# Tenant API

Every Hedra app exposes its configuration catalogue at `/tenants`. No application collection registration is required. A tenant has a required `name`, an immutable `tenantDomain`, and the standard server-managed UUID and timestamps. See the [configuration datastore](config-store.md) for its schema and programmatic operations.

## Create and rename a tenant

From the repository root with Bun and the project's dependencies installed:

```sh
bun run examples/07-tenants.ts
```

The example creates an in-memory Hedra app, creates `acme.hedra.local`, retrieves and filters the catalogue, changes its name, checks an invalid domain change and deletes it. It uses `app.request`, opens no listener and leaves no database file.

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

Name-only definitions now need an explicitly assigned valid, unique `tenantDomain`. No migration invents domains. Back up existing data and assign domains before using the REST catalogue; a definition missing its domain fails output validation instead of being returned as a valid Tenant.
