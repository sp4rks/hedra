# Tenancy

Assumes you've finished [Tutorial 3: Add environments](../tutorial/03-environments.md).

## The problem

One Hedra app serves many customers. Each customer needs its own data and settings. Most customers also need separations of their own, such as development and production, or two brands. A request has to reach the right customer and the right separation, and nothing else.

## How Hedra approaches it

Hedra has three levels, and each one is identified by a domain. With the tutorial's settings:

| Level | Domain | Tutorial example |
| --- | --- | --- |
| [Deployment](../reference/glossary.md) | The root, `HEDRA_DEPLOYMENT_DOMAIN` | `hedra.local` |
| [Tenant](../reference/glossary.md) | One [label](../reference/glossary.md) under the deployment domain | `acme.hedra.local` |
| [Environment](../reference/glossary.md) | One label under its tenant's domain | `dev.acme.hedra.local` |

A live deployment follows the same pattern under its own root. With `platformname.com` as the root, a customer is `customername.platformname.com`, and its development environment is `dev.customername.platformname.com`.

The deployment's API host, `deployment.hedra.local` in the tutorial, and its docs host are [reserved domains](../reference/glossary.md). A tenant can't claim them.

Domains are trimmed and lowercased wherever Hedra reads them, because host names ignore case. These domains are how a request will be matched to its tenant and environment. Routing requests by domain isn't part of Hedra yet.

Hedra splits each domain check in two. The model checks shape: a tenant domain is a domain at all. A validator checks place: a tenant domain is one label under this deployment's domain. Models never read the app's settings, so the validator takes the deployment domain and reserved domains as arguments.

## Trade-offs

- **Shape and place are separate.** A model loads without the app's settings. Zod's `.omit`, `.pick` and `.partial` throw on a schema with a check that spans two fields, so leaving place out of the model keeps variants like `NewTenant` working. The cost is that a route has to call the validator. Parsing alone accepts a tenant domain from another deployment.
- **The root comes from settings.** Hedra doesn't work out the root by removing a label from a host. A label count can't tell `hedra.local` from `hedra.co.uk`, and the setting already says which is meant.
- **The caller lists the reserved domains.** Hedra keeps no fixed list of names like `api` or `docs`. Only the deployment knows which hosts it serves, so it passes every one.
- **Exactly one label per level.** A tenant can't nest organisations inside its domain, and an environment can't have sub-environments.

## What this means for you

A tenant or environment is only checked against your deployment when its route calls the validator. The tutorial's routes parse first, then validate, then store. The deployment domain they pass is `hedra.config.deploymentDomain`, and the reserved domains are the API and docs hosts. Domains compare correctly after parsing, because parsing has already lowercased them.

Next: [How to define a model](../guides/data-and-models/define-a-model.md)
