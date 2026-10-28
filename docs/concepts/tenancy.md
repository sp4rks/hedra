# Tenancy

Assumes you've finished [Tutorial 3: Add environments](../tutorial/03-environments.md).

## The problem

One Hedra process serves many customers. Each customer needs its own data and settings. Most customers also need separations of their own: development and production, or two brands. A request has to reach the right customer and the right separation, and nothing else.

## How Hedra approaches it

Hedra has three levels, and each one is identified by a domain:

| Level | Domain | Example |
| --- | --- | --- |
| [Deployment](../reference/glossary.md) | The root, `HEDRA_DEPLOYMENT_DOMAIN` | `platformname.com` |
| [Tenant](../reference/glossary.md) | One label under the deployment domain | `customername.platformname.com` |
| [Environment](../reference/glossary.md) | One label under its tenant's domain | `dev.customername.platformname.com` |

The deployment's owners use their own host under the root, such as `platform.platformname.com`. That host and the docs host are [reserved domains](../reference/glossary.md), so a tenant can't claim them.

Domains are lowercased and trimmed wherever Hedra reads them, because host names ignore case. These domains are how a request will be matched to its tenant and environment. Routing requests by domain isn't part of Hedra yet.

Hedra splits each check in two. The model checks shape: a tenant domain is a domain at all. A validator checks place: a tenant domain is one label under this deployment's domain. The models never read the app's settings, so you pass the deployment domain and reserved domains to the validator.

## Trade-offs

- **Shape and place are separate.** A model loads without the app's settings, and `.omit`, `.pick` and `.partial` keep working. The cost is that a route has to call the validator. Parsing alone accepts a tenant domain from another deployment.
- **The root comes from settings.** Hedra doesn't work out the root by removing a label from a host. A label count can't tell `platformname.com` from `platformname.co.uk`. The setting already says which is meant.
- **You list the reserved domains.** Hedra keeps no fixed list of names like `api` or `docs`. Only your deployment knows which hosts it serves, so it has to pass every one.
- **Exactly one label per level.** A tenant can't nest organisations inside its domain, and an environment can't have sub-environments.

## What this means for you

Parse every tenant or environment with its model, then call its validator before you store it. Pass `HEDRA_DEPLOYMENT_DOMAIN` as the deployment domain, and every host your deployment serves as the reserved domains. Compare domains after parsing, because parsing lowercases them.

Related: [Models reference](../reference/models.md), [How to define a model](../guides/data-and-models/define-a-model.md)
