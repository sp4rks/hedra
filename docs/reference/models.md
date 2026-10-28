# Models reference

Every model, validator and constraint schema that Hedra exports. Inside the Hedra repository, import them from `#hedra.ts`. The package name is `hedra`, and it isn't published yet.

```ts
import { Deployment, Domain, Environment, Resource, Tenant } from '#hedra.ts'
```

Each model is a Zod schema and a TypeScript type with the same name. A failed `parse` throws a `ZodError`, and `safeParse` returns its issues.

Every field carries a description and an example in its metadata, and timestamps also carry `format: 'date-time'`. `z.toJSONSchema` includes them in the JSON Schema it produces. Nothing else in Hedra reads them yet.

## Resource

The base model. `Tenant` and `Environment` extend it.

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | UUID string | none, required | The record's unique identifier |
| `name` | string, trimmed, 2–64 characters | none, required | The record's name |
| `description` | string, trimmed, 1–128 characters, or `null` | omitted | The record's description |
| `createdAt` | ISO 8601 date-time ending in `Z` | none, required | When the record was created |
| `updatedAt` | ISO 8601 date-time ending in `Z` | none, required | When the record was last updated |

A timestamp with a numeric offset, such as `+10:00`, or with no zone at all, fails.

## Domain

A host name. It is trimmed and lowercased, then must match Zod's domain pattern, `z.regexes.domain`:

- at least two labels, and at most 253 characters in all;
- each label 1–63 letters, digits or hyphens, not starting or ending with a hyphen;
- a last label of 2–63 letters.

`localhost`, a trailing dot and empty labels fail.

## Deployment

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `deploymentDomain` | `Domain` | none, required | The deployment's root domain, the same value as `HEDRA_DEPLOYMENT_DOMAIN` |

`Deployment` describes the deployment itself, and doesn't extend `Resource`. Nothing in Hedra uses it yet. To check a value against the configured deployment domain, call `deploymentDomainValidator`.

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
| `deploymentDomainValidator` | `value: string`, `deploymentDomain: string` | `value` is `deploymentDomain` |
| `tenantDomainValidator` | `value: string`, `deploymentDomain: string`, `reservedDomains: string[]` | `value` is one label, a dot, then `deploymentDomain`, and isn't in `reservedDomains` |
| `environmentDomainValidator` | `value: string`, `tenantDomain: string` | `value` is one label, a dot, then `tenantDomain` |

With `platformname.com` as the deployment domain, `tenantDomainValidator` returns `false` for `platformname.com`, `customerplatformname.com` and `dev.customername.platformname.com`.

## Constraint schemas

`constraints` in a field's or object's `.meta()` declares how records relate. Constraints are stored in the schema's metadata. Nothing in Hedra reads them yet, so nothing builds an index or enforces them.

`RecordFieldConstraints` describes one field:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `unique` | boolean | omitted | No two records share this field's value |
| `indexed` | boolean | omitted | Records are often found by this field. Meaningless when `unique` is set |

`RecordSchemaConstraints` describes a whole record:

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| `compoundUnique` | array of `{ fields: string[] }` | omitted | Each entry lists fields whose values are unique together |

A record's constraints go in the object schema's own `.meta()`:

```ts
const Member = Resource.extend({ email: z.email() }).meta({
  constraints: { compoundUnique: [{ fields: ['email', 'name'] }] },
})
```

Both schemas are strict. An unknown key fails with `Unrecognized key: "<key>"`.

Hedra's own models declare these field constraints:

| Field | Constraint |
| --- | --- |
| `Tenant.tenantDomain` | `unique` |
| `Environment.environmentDomain` | `unique` |
| `Environment.tenantDomain` | `indexed` |

Related: [Configuration reference](configuration.md), [Tenancy](../concepts/tenancy.md), [Glossary](glossary.md)
