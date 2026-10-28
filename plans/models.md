# Models

Foundation schemas for a multi-tenant Hedra deployment. The design and tests below were agreed with the user.

## Behaviour

One process serves one deployment. A deployment has many tenants, and a tenant owns many environments. Each is identified by a domain, and those domains are how traffic will find a tenant. Routing itself is a later feature.

| Level | Config | Example |
| --- | --- | --- |
| Deployment domain, the root | `HEDRA_DEPLOYMENT_DOMAIN` | `platformname.com` |
| Deployment owner's host | `HEDRA_DEPLOYMENT_API_DOMAIN` | `platform.platformname.com` |
| Tenant, a customer organisation | | `customername.platformname.com` |
| Environment, inside a tenant | | `dev.customername.platformname.com` |

A tenant domain is one label under the deployment domain. An environment domain is one label under its tenant's domain. That label names the separation: `dev`, `test`, `prod`, a brand or a use case. Hosts the deployment already serves, such as the owner's host and the docs host, are reserved and can't be tenant domains.

Domains are trimmed and lowercased. `name` and `description` are trimmed before their length checks. `createdAt` and `updatedAt` are UTC instants written with a `Z` suffix. `.describe()` and `.meta()` stay on the schemas for a later OpenAPI generator. This feature does not generate a document.

## Schemas

`Resource` is the base for a stored object:

- `id`: UUID
- `name`: trimmed string, 2–64 characters
- `description`: trimmed string, 1–128 characters, and it may be omitted or `null`
- `createdAt`, `updatedAt`: ISO datetimes with a `Z` suffix

`Domain` is a string, trimmed and lowercased, that matches `z.regexes.domain`. It rejects `localhost`, a trailing dot and empty labels.

`Deployment` is `{ deploymentDomain: Domain }` and does not extend `Resource`. `deploymentDomain` is the root, with the same name and value as `HEDRA_DEPLOYMENT_DOMAIN`. Its example is `platformname.com`.

`Tenant` is `Resource.extend` with a unique `tenantDomain`. Its example is `customername.platformname.com`. A value that is not a domain reports `Invalid tenant domain`.

`Environment` is `Resource.extend` with a unique `environmentDomain` and an indexed `tenantDomain`. Its examples are `dev.customername.platformname.com` and `customername.platformname.com`. Values that are not domains report `Invalid environment domain` and `Invalid tenant domain`.

The schemas check shape only. They don't know the configured deployment domain, and `Environment` has no cross-field refinement, because a refined Zod object can't be used with `.omit`, `.pick` or `.partial`. The caller runs the validators below.

`RecordFieldConstraints` and `RecordSchemaConstraints` are strict Zod schemas for the `constraints` object stored in `.meta()`. `unique` means no two records share the value. `indexed` means a store may index the field, and it is meaningless when `unique` is set. `compoundUnique` lists field sets that are unique together. An unknown key fails with Zod's `Unrecognized key: "<key>"`. Nothing in this feature builds an index.

## Validators

The validators are pure. They run every domain argument through `Domain`, so comparisons ignore case. Nothing in `src/models/` imports server config.

- `deploymentDomainValidator(value, deploymentDomain)` is true when `value` is a domain equal to `deploymentDomain`.
- `tenantDomainValidator(value, deploymentDomain, reservedDomains)` is true when `value` is one label, a dot, then `deploymentDomain`, and isn't in `reservedDomains`. The dot means `customerplatformname.com` doesn't belong to `platformname.com`.
- `environmentDomainValidator(value, tenantDomain)` is true when `value` is one label, a dot, then `tenantDomain`.

## Public interface

`src/models/models.ts` re-exports the schemas, their inferred types, the three validators and the two constraint schemas. `src/hedra.ts` exports those same names. There is no `hedra/models` subpath.

```ts
import { Hedra, Resource, Domain, Deployment, Tenant, Environment } from 'hedra'
```

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

There is no `categories` directory. Sibling files import each other by path, such as `#models/resource.ts`. Everything else imports `#models`. Implementation adds `"#models": "./src/models/models.ts"` to the package `imports` map.

## Tests

Each file is under `tests/models/`. Model tests import from `#models`. The export test imports `#hedra.ts`, as the existing tests do, because the bare package name `hedra` doesn't resolve without an `exports` entry.

`resource.test.ts`

- `Resource parses a complete resource`
- `Resource trims name and description`
- `Resource rejects a name under 2 characters after trimming`
- `Resource rejects a name over 64 characters`
- `Resource accepts an omitted or null description`
- `Resource rejects a blank description`
- `Resource rejects a description over 128 characters`
- `Resource rejects an id that is not a UUID`
- `Resource rejects a timestamp without a Z suffix`
- `Resource carries OpenAPI descriptions, examples and date-time formats`, checked through `z.toJSONSchema(Resource)`

`domain.test.ts`

- `Domain accepts a hostname`
- `Domain trims and lowercases a hostname`
- `Domain rejects a value that is not a hostname`
- `deploymentDomainValidator accepts the deployment domain in any case`
- `deploymentDomainValidator rejects any other domain`
- `tenantDomainValidator accepts one label under the deployment domain in any case`
- `tenantDomainValidator rejects the deployment domain itself`
- `tenantDomainValidator rejects a domain that only shares the deployment domain's suffix`
- `tenantDomainValidator rejects more than one label under the deployment domain`
- `tenantDomainValidator rejects a reserved domain in any case`
- `tenantDomainValidator rejects a value that is not a domain`
- `environmentDomainValidator accepts one label under the tenant domain in any case`
- `environmentDomainValidator rejects the tenant domain itself`
- `environmentDomainValidator rejects a domain outside the tenant`
- `environmentDomainValidator rejects more than one label under the tenant domain`

`deployment.test.ts`

- `Deployment parses and lowercases a deployment domain`
- `Deployment rejects a value that is not a domain`

`tenant.test.ts`

- `Tenant parses a resource with a tenant domain`
- `Tenant requires the Resource fields`
- `Tenant reports Invalid tenant domain for a value that is not a domain`
- `Tenant marks tenantDomain unique`

`environment.test.ts`

- `Environment parses a resource with environment and tenant domains`
- `Environment requires the Resource fields`
- `Environment reports Invalid environment domain and Invalid tenant domain for values that are not domains`
- `Environment leaves the domain hierarchy to environmentDomainValidator`
- `Environment marks environmentDomain unique and tenantDomain indexed`
- `Environment derives variants with omit, pick and partial`

`record-constraints.test.ts`

- `RecordFieldConstraints accepts unique and indexed`
- `RecordFieldConstraints names an unknown key in its error`
- `RecordSchemaConstraints accepts compoundUnique field sets`
- `RecordSchemaConstraints names an unknown key in its error`
- `RecordSchemaConstraints rejects a compound key that is not a list of field names`

`models.test.ts`

- `hedra exports every model, validator and constraint schema from #models`

## Out of scope

Query parameters, the JSON:API envelope, `instanceSchema`, host-based routing and OpenAPI generation.

The routing feature passes `HEDRA_DEPLOYMENT_DOMAIN` as the deployment domain and the hosts the deployment serves, including `HEDRA_DEPLOYMENT_API_DOMAIN` and `HEDRA_DEPLOYMENT_DOCS_DOMAIN`, as reserved domains.

## Records

The import rule is in [CODING_STYLE.md](../CODING_STYLE.md) and [ADR 0001](../docs/adr/0001-model-imports.md).
