# Models reference

Every model, validator and constraint schema that Hedra exports. Import them from `hedra`, or from `#hedra.ts` inside the Hedra repository.

```ts
import { Deployment, Domain, Environment, Resource, Tenant } from 'hedra'
```

Each model is a Zod schema and a TypeScript type with the same name. A failed `parse` throws a `ZodError`, and `safeParse` returns its issues.

## Resource

The base model. `Tenant` and `Environment` extend it.

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | UUID string | none, required | The unique identifier for the resource |
| `name` | string, trimmed, 2–64 characters | none, required | The name of the object |
| `description` | string, trimmed, 1–128 characters, or `null` | omitted | The description of the object |
| `createdAt` | ISO 8601 date-time ending in `Z` | none, required | The date and time the object was created |
| `updatedAt` | ISO 8601 date-time ending in `Z` | none, required | The date and time the object was last updated |

A timestamp with a numeric offset, such as `+10:00`, or with no zone at all, fails.

## Domain

A host name. It is trimmed and lowercased, then must match Zod's domain pattern. `localhost`, a trailing dot and empty labels fail.

## Deployment

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `deploymentDomain` | `Domain` | none, required | The deployment's root domain, the same value as `HEDRA_DEPLOYMENT_DOMAIN` |

`Deployment` doesn't extend `Resource`.

## Tenant

`Resource`'s fields, plus:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `tenantDomain` | `Domain`, unique | none, required | The domain name of the tenant |

A value that isn't a domain fails with `Invalid tenant domain`.

## Environment

`Resource`'s fields, plus:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `environmentDomain` | `Domain`, unique | none, required | The domain name of the environment |
| `tenantDomain` | `Domain`, indexed | none, required | The domain name of the environment's tenant |

Values that aren't domains fail with `Invalid environment domain` and `Invalid tenant domain`. Parsing doesn't check that `environmentDomain` sits under `tenantDomain`. Call `environmentDomainValidator` for that.

## Validators

Each validator returns a boolean and never throws. It runs every domain argument through `Domain` first, so case and surrounding spaces don't matter. A value that isn't a domain returns `false`.

| Name | Arguments | Returns `true` when |
| --- | --- | --- |
| `deploymentDomainValidator` | `value`, `deploymentDomain` | `value` is `deploymentDomain` |
| `tenantDomainValidator` | `value`, `deploymentDomain`, `reservedDomains` | `value` is one label, a dot, then `deploymentDomain`, and isn't in `reservedDomains` |
| `environmentDomainValidator` | `value`, `tenantDomain` | `value` is one label, a dot, then `tenantDomain` |

With `platformname.com` as the deployment domain, `tenantDomainValidator` returns `false` for `platformname.com`, `customerplatformname.com` and `dev.customername.platformname.com`.

## Constraint schemas

`constraints` in a field's or object's `.meta()` declares how records relate. Hedra records constraints. It doesn't build indexes or enforce them.

`RecordFieldConstraints` describes one field:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `unique` | boolean | omitted | No two records share this field's value |
| `indexed` | boolean | omitted | Records are often found by this field. Meaningless when `unique` is set |

`RecordSchemaConstraints` describes a whole record:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `compoundUnique` | array of `{ fields: string[] }` | omitted | Each entry lists fields whose values are unique together |

Both schemas are strict. An unknown key fails with `Unrecognized key: "<key>"`.

| Field | Constraint |
| --- | --- |
| `Tenant.tenantDomain` | `unique` |
| `Environment.environmentDomain` | `unique` |
| `Environment.tenantDomain` | `indexed` |

Related: [Tenancy](../concepts/tenancy.md), [Glossary](glossary.md)
