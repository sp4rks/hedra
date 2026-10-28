# 2. Accept tenants

Your app answers on port 3000. By the end of this chapter, it accepts customers over HTTP and refuses domains that don't belong to it.

## Find the deployment's domains

Run the app from chapter 1 again and read the first three rows of the settings table:

```text
HEDRA_DEPLOYMENT_DOMAIN                            hedra.local                                        default
HEDRA_DEPLOYMENT_API_DOMAIN                        deployment.hedra.local                             default
HEDRA_DEPLOYMENT_DOCS_DOMAIN                       docs.hedra.local                                   default
```

Every customer of this app gets a domain one label under `hedra.local`, such as `acme.hedra.local`. The other two hosts already belong to the app, so no customer can have them. Stop the app.

## Add the tenant routes

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
    return context.json({ errors: ['Invalid tenant domain'] }, 400)
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

- `hedra.config` holds the settings from the table. Its values are typed as possibly missing, so each falls back to an empty string, which no domain matches.
- `NewTenant` is `Tenant` without `id`, `createdAt` and `updatedAt`, because the app sets those. The request body only has to carry a name and a domain.
- `NewTenant.safeParse` checks the request body's shape. It trims the name and lowercases the domain.
- `tenantDomainValidator` checks that the domain is one label under `hedra.local`, and is not one of the app's own hosts.
- `tenants` keeps each tenant in memory, keyed by its domain, until the app stops.

## Check your work

Start the app:

```sh
bun run examples/tutorial/02-tenants.ts
```

In a second terminal, add a tenant. The domain has a capital letter on purpose:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Widgets","tenantDomain":"Acme.hedra.local"}'
```

The app returns the tenant with the domain in lowercase. Your `id` and timestamps differ:

```json
{"id":"5c1e3c2a-8f0e-4c1b-9f7a-2d3e4f5a6b7c","name":"Acme Widgets","createdAt":"2026-10-28T09:30:00.000Z","updatedAt":"2026-10-28T09:30:00.000Z","tenantDomain":"acme.hedra.local"}
```

Try to take the docs host:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Docs","tenantDomain":"docs.hedra.local"}'
```

```json
{"errors":["Invalid tenant domain"]}
```

Send a value that isn't a domain:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Broken","tenantDomain":"not a domain"}'
```

```json
{"errors":["Invalid tenant domain"]}
```

The first failure comes from `tenantDomainValidator`. The second comes from `NewTenant.safeParse`, which rejects the value before the validator runs.

List the tenants:

```sh
curl http://localhost:3000/tenants
```

The list holds the one tenant you added. Stop the app with Ctrl+C.

## What you learned

The app serves one **deployment**: everything it hosts under one root domain. That root is the **deployment domain**, set by `HEDRA_DEPLOYMENT_DOMAIN`.

A **tenant** is a customer organisation in the deployment. Its **tenant domain** is one label under the deployment domain. Hosts the deployment already serves, such as its API and docs hosts, are **reserved domains**, and no tenant can have one.

`Tenant` is a **model**: a Zod schema and a TypeScript type with the same name. It extends **`Resource`**, the base model that gives every record an `id`, `name`, optional `description`, `createdAt` and `updatedAt`. A model checks a value's shape. Whether a tenant domain belongs to this deployment depends on the app's settings, so `tenantDomainValidator` checks it with the domains you pass.

Next: [3. Add environments](03-environments.md)
