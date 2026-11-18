# Backlog

Architectural follow-ups from the 2026-11-14 comparison of Hedra `7804a1b` and M21 `b16891a`
([archived M21 checkout](/home/sparks/projects/zArchive/round2/hailmary/multi21)). These are the five areas
where M21's approach was preferred. Runtime differences are excluded. All items are proposed work.

Preserve Hedra's [design goals](IDEA.md), generic storage contracts, explicit dependency ownership and
atomic validation. The decisions on [root-only CRUD](docs/adr/0030-root-crud-and-ordinary-nested-data.md)
and [controller-owned output](docs/adr/0031-controller-owned-public-output.md) remain in effect.

## Tenants and environments

- [ ] Add environment management and tenant/environment scoping for application resources and custom handlers.

Hedra currently provides a tenant catalogue, but no environment resources, request tenant resolution or
application-data isolation. Its resource scope describes only the addressed collection or resource ID.

M21 provides built-in environments and derives tenant/environment scope from the request hostname.
Its default resource controllers inject `environmentDomain`, filter lists and check scope on individual
reads and mutations. Its `scoped` custom handlers receive resolved tenant and environment records.
This is a core capability for a framework serving multiple tenants in one deployment.

Extend configuration operations, request resolution, resource controllers and custom-handler access
together. Retain Hedra's independent configuration datastore and root CRUD. Define how existing
unscoped data acquires ownership before enabling isolation. Hostname selection supplies no
authentication or authorization; neither framework currently provides those controls.

Hedra references: [tenant boundary](docs/tenants.md#host-and-storage-boundaries),
[configuration datastore](src/datastores/categories/config/config.ts), [resource scope](src/models/scope.ts).
M21 references: `src/controllers/environment-controller.ts`, `src/controllers/resource-controller.ts`,
`src/server/utils/request-scope.ts` and `src/server/server.ts` in the archived checkout.

## Query capabilities

- [ ] Add bounded pagination, sorting, counts, navigation links and richer collection filters.

Hedra supports typed scalar equality filters and returns every matching resource in insertion order.
M21 supports page number/size, comma-separated sorting, counts and pagination links, plus `eq`, `ne`,
`like` and `ilike` filters. Pagination bounds response sizes; ordering and navigation make growing
collections practical to consume.

Evolve query schemas, HTTP parsing, controllers, backend operations and response models together.
Keep field validation and public-field restrictions. Define compatibility with the existing JSON
`filter` parameter and response links when introducing the broader query contract.

Hedra references: [query and response models](src/models/rest.ts), [route parsing](src/routes/resources.ts),
[backend contract](src/datastores/backend.ts).
M21 references: `src/models/categories/query-params.ts`, `src/server/utils/jsonapi-parser.ts` and
`src/datastores/tenant/mongodb/query-builder.ts` in the archived checkout.

## Indexes and constraints

- [ ] Derive indexes and uniqueness constraints from resource-model metadata.

Hedra has no general schema-derived index or constraint mechanism. Tenant-domain uniqueness is an
explicit transactional check. M21 reads Zod field metadata for `unique` and `indexed`, and object
metadata for compound uniqueness, then creates MongoDB indexes. This keeps reusable persistence
constraints beside their models and allows the database to enforce uniqueness.

Adapt the approach to Hedra's generic backend and SQLite storage. Cover every registered collection,
including collections added after construction: M21's startup index flow does not automatically cover
later registrations. Define how existing duplicate data is reported before adding unique constraints;
retain atomic tenant uniqueness during any transition.

Hedra references: [backend contract](src/datastores/backend.ts),
[SQLite storage](src/datastores/backends/sqlite/sqlite.ts),
[tenant operations](src/datastores/categories/config/tenants.ts).
M21 references: `src/models/categories/record-constraints.ts`,
`src/datastores/tenant/mongodb/index-specs-from-schema.ts` and
`docs/adr/0007-mongodb-indexes-from-zod-constraints.md` in the archived checkout.

## Generated API documentation

- [ ] Generate OpenAPI from registered collections and serve an API reference on documentation hosts.

Hedra has no OpenAPI generation or documentation routing, although `deploymentDocsDomain` is already
configured. M21 generates CRUD documentation from Zod schemas, refreshes it when collections are
registered, separates deployment and tenant/admin API documents, and serves Scalar on selected hosts.
This avoids maintaining a second set of API definitions by hand.

Use Zod's native `z.toJSONSchema()` support and describe Hedra's actual input, public output, query and
error contracts. Preserve the deployment/tenant documentation boundary as environment support is
added. M21's Scalar UI loads from a CDN, so retain that offline limitation in the UI delivery decision.

Hedra references: [collection definitions](src/models/collection.ts), [routes](src/routes/resources.ts),
[deployment settings](src/server/configs/deployment.ts).
M21 references: `src/server/openapi/`, `src/server/server.ts` and
`docs/adr/0009-dynamic-openapi-from-zod-resources.md` in the archived checkout.

## HTTP logging

- [x] Install request/response logging middleware and honour `serverHttpLogEnabled`.

Hedra uses the app's `LoggerInterface` to record request ID, method, route pattern, response status and
elapsed time across built-in, generated and custom routes. The response carries the same request ID.
Access records omit raw request bodies and URLs.

Hedra references: [app construction](src/server/server.ts), [logger contract](src/server/logger.ts),
[HTTP logging setting](src/server/configs/server.ts).
M21 references: `src/server/logging/logging.ts` and `src/server/server.ts` in the archived checkout.
