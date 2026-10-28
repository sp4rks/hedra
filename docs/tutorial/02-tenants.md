# 2. Accept tenants

Your app answers on port 3000. By the end of this chapter, it accepts customers over HTTP and refuses domains that don't belong to it.

## Find the app's domains

The first rows of the settings table from chapter 1 are domains:

```text
Environment Variable                               Value                                              Source
HEDRA_DEPLOYMENT_DOMAIN                            hedra.local                                        default
HEDRA_DEPLOYMENT_API_DOMAIN                        deployment.hedra.local                             default
HEDRA_DEPLOYMENT_DOCS_DOMAIN                       docs.hedra.local                                   default
```

`hedra.local` is the root that everything else sits under. The app keeps the other two hosts for itself, one for its own API and one for its docs. It doesn't serve anything on them yet, but no customer can have them.

A domain is made of labels, the parts between the dots. `acme.hedra.local` has three: `acme`, `hedra` and `local`. Hedra calls each customer a tenant. Each tenant gets a domain exactly one label under the root, such as `acme.hedra.local`.

## Read the tenant routes

The app for this chapter is `examples/tutorial/02-tenants.ts`. It keeps chapter 1's route and adds `GET /tenants` and `POST /tenants`:

```ts
import { Hedra, Tenant, tenantDomainValidator } from '#hedra.ts'

const hedra = new Hedra()
hedra.get('/', (context) => context.text('Hello Hedra!'))

const { deploymentDomain = '', deploymentApiDomain = '', deploymentDocsDomain = '' } = hedra.config
const reservedDomains = [deploymentApiDomain, deploymentDocsDomain]

const NewTenant = Tenant.omit({ id: true, createdAt: true, updatedAt: true })
const tenants = new Map<string, Tenant>()

hedra.get('/tenants', (context) => context.json([...tenants.values()]))

hedra.post('/tenants', async (context) => {
  const input = NewTenant.safeParse(await context.req.json())
  if (!input.success) {
    return context.json({ errors: input.error.issues.map((issue) => issue.message) }, 400)
  }

  const { tenantDomain } = input.data
  if (!tenantDomainValidator(tenantDomain, deploymentDomain, reservedDomains)) {
    return context.json({ errors: ['Tenant domain is not available in this deployment'] }, 400)
  }
  if (tenants.has(tenantDomain)) {
    return context.json({ errors: ['Tenant domain already exists'] }, 409)
  }

  const now = new Date().toISOString()
  const tenant = Tenant.parse({ ...input.data, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
  tenants.set(tenant.tenantDomain, tenant)

  return context.json(tenant, 201)
})

export default hedra
```

What the new code does:

- `hedra.config` holds the settings from the table. `hedra.config.deploymentDomain` is `HEDRA_DEPLOYMENT_DOMAIN`, `deploymentApiDomain` is `HEDRA_DEPLOYMENT_API_DOMAIN`, and `deploymentDocsDomain` is `HEDRA_DEPLOYMENT_DOCS_DOMAIN`.
- `hedra.config` is typed as a record of strings, so TypeScript can't know a key is there. Each value falls back to an empty string to satisfy the type. With the settings above, every value is set.
- `Tenant` is a schema from [Zod](https://zod.dev), the validation library Hedra uses. `.omit`, `.safeParse` and `.parse` are Zod methods. `Tenant` is also a TypeScript type with the same name, so `Map<string, Tenant>` holds tenants.
- `NewTenant` is `Tenant` without `id`, `createdAt` and `updatedAt`, because the app sets those. A request body only has to carry a name and a domain.
- `NewTenant.safeParse` checks the request body. It trims the name and lowercases the domain. A value that isn't a domain fails with `Invalid tenant domain`.
- `tenantDomainValidator` checks that the domain is one label under `hedra.local`, and isn't the API or docs host. When it fails, the route answers `Tenant domain is not available in this deployment`.
- `tenants` keeps each tenant in memory, keyed by its domain, until the app stops.

The tenant domain is data. You still send every request to `localhost:3000`, because Hedra doesn't route requests by domain yet.

## Check your work

Start the app:

```sh
bun run examples/tutorial/02-tenants.ts
```

In a second terminal, add a tenant. The domain has a capital letter on purpose. `-w` prints the HTTP status after the body:

```sh
curl -w '\n%{http_code}\n' -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Widgets","tenantDomain":"Acme.hedra.local"}'
```

The app returns the tenant, with the domain in lowercase, and status 201. Your `id` and timestamps differ:

```text
{"id":"5c1e3c2a-8f0e-4c1b-9f7a-2d3e4f5a6b7c","name":"Acme Widgets","createdAt":"2026-10-28T09:30:00.000Z","updatedAt":"2026-10-28T09:30:00.000Z","tenantDomain":"acme.hedra.local"}
201
```

Add the same tenant again:

```sh
curl -w '\n%{http_code}\n' -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Widgets","tenantDomain":"acme.hedra.local"}'
```

```text
{"errors":["Tenant domain already exists"]}
409
```

Try to take the docs host:

```sh
curl -w '\n%{http_code}\n' -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Docs","tenantDomain":"docs.hedra.local"}'
```

```text
{"errors":["Tenant domain is not available in this deployment"]}
400
```

Try a domain two labels under the root:

```sh
curl -w '\n%{http_code}\n' -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Too deep","tenantDomain":"dev.acme.hedra.local"}'
```

```text
{"errors":["Tenant domain is not available in this deployment"]}
400
```

Send a value that isn't a domain at all:

```sh
curl -w '\n%{http_code}\n' -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Broken","tenantDomain":"not a domain"}'
```

```text
{"errors":["Invalid tenant domain"]}
400
```

The last message comes from `NewTenant.safeParse`, before the validator runs.

List the tenants:

```sh
curl http://localhost:3000/tenants
```

The list holds the one tenant you added:

```text
[{"id":"5c1e3c2a-8f0e-4c1b-9f7a-2d3e4f5a6b7c","name":"Acme Widgets","createdAt":"2026-10-28T09:30:00.000Z","updatedAt":"2026-10-28T09:30:00.000Z","tenantDomain":"acme.hedra.local"}]
```

Stop the app with Ctrl+C.

## What you learned

The app serves one **deployment**: everything it hosts under one root domain. That root is the **deployment domain**, set by `HEDRA_DEPLOYMENT_DOMAIN`.

A **tenant** is a customer organisation in the deployment. Its **tenant domain** is one **label** under the deployment domain. Hosts the deployment keeps for itself, such as its API and docs hosts, are **reserved domains**, and no tenant can have one.

`Tenant` is a **model**: a Zod schema and a TypeScript type with the same name. It extends **`Resource`**, the base model that gives every record an `id`, `name`, optional `description`, `createdAt` and `updatedAt`. The model checks that a tenant domain is a domain.

`tenantDomainValidator` is a **validator**: a function that returns `true` or `false`. It checks that a tenant domain belongs to this deployment, using the domains you pass it.

Inside Hedra, the `Tenant` model marks `tenantDomain` as unique. That mark is a **constraint**: it states a rule about records, and Hedra doesn't enforce it yet. Your route enforces it itself, with `tenants.has`. The [models reference](../reference/models.md#constraint-schemas) lists the constraints each model declares.

Next: [3. Add environments](03-environments.md)
