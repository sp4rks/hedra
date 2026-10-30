# Glossary

Every Hedra term, with the chapter that introduces it.

| Term | Meaning | Introduced in |
| --- | --- | --- |
| App | An instance of `Hedra`: a Hono app with Hedra's settings, a JSON logger and a health check | [1. Hello Hedra](../tutorial/01-hello-hedra.md) |
| Constraint | A rule about records declared in a model's metadata, such as `unique`. Hedra doesn't enforce constraints yet | [2. Accept tenants](../tutorial/02-tenants.md) |
| Deployment | Everything one Hedra app serves under one root domain | [2. Accept tenants](../tutorial/02-tenants.md) |
| Deployment domain | The deployment's root domain, set by `HEDRA_DEPLOYMENT_DOMAIN` | [2. Accept tenants](../tutorial/02-tenants.md) |
| Environment | The smallest separation inside a tenant, such as `dev`, `prod` or a brand. Unrelated to `HEDRA_SERVER_ENV` | [3. Add environments](../tutorial/03-environments.md) |
| Environment domain | One label under the tenant domain, such as `dev.acme.hedra.local` | [3. Add environments](../tutorial/03-environments.md) |
| Label | One dot-separated part of a domain. `acme.hedra.local` has three | [2. Accept tenants](../tutorial/02-tenants.md) |
| Model | A Zod schema and the TypeScript type of the same name | [2. Accept tenants](../tutorial/02-tenants.md) |
| Reserved domain | A host the deployment keeps for itself, such as its API or docs host, which no tenant can have | [2. Accept tenants](../tutorial/02-tenants.md) |
| Resource | The base model with `id`, `name`, `description`, `createdAt` and `updatedAt` | [2. Accept tenants](../tutorial/02-tenants.md) |
| Tenant | A customer organisation in the deployment | [2. Accept tenants](../tutorial/02-tenants.md) |
| Tenant domain | One label under the deployment domain, such as `acme.hedra.local` | [2. Accept tenants](../tutorial/02-tenants.md) |
| Validator | A function that returns `true` or `false`, such as `tenantDomainValidator`, which checks that a tenant domain belongs to the deployment | [2. Accept tenants](../tutorial/02-tenants.md) |
