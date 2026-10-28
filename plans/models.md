# Models

Foundation schemas for a multi-tenant Hedra deployment. Agreed during design. Tests are proposed after this plan is approved.

## Behaviour

One process has one deployment. The deployment domain is the owner's host, such as `platform.platformname.com`. The parent zone is that host with its first label removed, such as `platformname.com`. This is a label split, not a public-suffix list, so the deployment domain is a host with one label in front of the zone.

A tenant is an organisation. Its domain is one label plus the zone, such as `customername.platformname.com`. That host is not the deployment domain.

An environment is the lowest separation inside a tenant: `dev`, `test`, `prod`, a brand, or a use case. Its domain is one label plus that tenant's domain, such as `dev.customername.platformname.com`. The label is any DNS label.

These domains are how traffic will find a tenant. Routing itself is a later feature.

`name` and `description` are trimmed before their length checks. `createdAt` and `updatedAt` are UTC instants written with a `Z` suffix. `.describe()` and `.meta()` stay on the schemas for a later OpenAPI generator. This feature does not generate a document.

## Schemas

`Resource` is the base for a stored object:

- `id`: UUID
- `name`: trimmed string, 2–64 characters
- `description`: trimmed string, 1–128 characters, and it may be omitted or `null`
- `createdAt`, `updatedAt`: ISO datetimes with a `Z` suffix

`Domain` is a string that matches `z.regexes.domain`.

`Deployment` is `{ deploymentDomain: Domain }`. It does not extend `Resource`. `Deployment.parse` accepts any domain. `deploymentDomainValidator(value, configuredDeploymentDomain)` is what checks that the value is this process's host.

`Tenant` is `Resource.extend` with a unique `tenantDomain`. `Tenant.parse` checks the shape, including that `tenantDomain` is a `Domain`. It does not know the deployment domain. The caller then runs `tenantDomainValidator(value, configuredDeploymentDomain)`.

`Environment` is `Resource.extend` with a unique `environmentDomain` and an indexed `tenantDomain`. `Environment.parse` checks that `environmentDomain` is one label plus the record's own `tenantDomain`, because both fields are on the record. Checking that `tenantDomain` belongs to the deployment still needs `tenantDomainValidator` and the configured host.

Examples on the schemas are `platform.platformname.com`, `customername.platformname.com`, and `dev.customername.platformname.com`. A bad tenant domain reports `Invalid tenant domain`.

`RecordFieldConstraints` and `RecordSchemaConstraints` are Zod schemas for the `constraints` object stored in `.meta()`. `unique` means no two records share the value. `indexed` means a store may index the field, and it is meaningless when `unique` is set. `compoundUnique` lists field sets that are unique together. Nothing in this feature builds an index.

## Validators

The validators are pure. They take the parent domain as an argument. Nothing in `src/models/` imports server config.

- `deploymentDomainValidator(value, deploymentDomain)` is true when `value` is a `Domain` and equals `deploymentDomain`.
- `tenantDomainValidator(value, deploymentDomain)` is true when `value` is a `Domain`, equals one label plus the zone of `deploymentDomain`, and is not `deploymentDomain` itself. A dot sits between the label and the zone, so `notplatformname.com` does not belong to `platformname.com`.
- `environmentDomainValidator(value, tenantDomain)` is true when `value` is one label plus `tenantDomain`, again with a dot on the boundary.

## Public interface

`src/models/models.ts` re-exports the schemas, their inferred types, and the three validators. `src/hedra.ts` exports those same names.

```ts
import { Hedra, Resource, Domain, Deployment, Tenant, Environment } from 'hedra'
```

The validators and the two constraint schemas are exported from `hedra` as well. There is no `hedra/models` subpath.

## Layout

```text
src/models/resource.ts
src/models/domain.ts
src/models/deployment.ts
src/models/tenant.ts
src/models/environment.ts
src/models/record-constraints.ts
src/models/models.ts
```

There is no `categories` directory. Sibling files import `#models/resource.ts` and the other file paths. Everything else imports `#models`. Implementation adds `"#models": "./src/models/models.ts"` to the package `imports` map. `#models/resource.ts` already resolves through `#*`.

## Out of scope

Query parameters, the JSON:API envelope, `instanceSchema`, host-based routing, and OpenAPI generation.

## Records

The import rule is in [CODING_STYLE.md](../CODING_STYLE.md) and [ADR 0001](../docs/adr/0001-model-imports.md).
