# 3. Add environments

Your app accepts tenants. By the end of this chapter, each tenant can have its own environments, such as `dev` and `prod`.

## Add the environment routes

The app for this chapter is `examples/tutorial/03-environments.ts`. It keeps chapter 2's code and adds `GET /environments` and `POST /environments`:

```ts
import { Environment, environmentDomainValidator, Hedra, Tenant, tenantDomainValidator } from '#hedra.ts'

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

const NewEnvironment = Environment.omit({ id: true, createdAt: true, updatedAt: true })
const environments = new Map<string, Environment>()

hedra.get('/environments', (context) => context.json([...environments.values()]))

hedra.post('/environments', async (context) => {
  const input = NewEnvironment.safeParse(await context.req.json())
  if (!input.success) {
    return context.json({ errors: input.error.issues.map((issue) => issue.message) }, 400)
  }

  const { environmentDomain, tenantDomain } = input.data
  if (!tenants.has(tenantDomain)) {
    return context.json({ errors: ['Unknown tenant domain'] }, 404)
  }
  if (!environmentDomainValidator(environmentDomain, tenantDomain)) {
    return context.json({ errors: ['Invalid environment domain'] }, 400)
  }
  if (environments.has(environmentDomain)) {
    return context.json({ errors: ['Environment domain already exists'] }, 409)
  }

  const now = new Date().toISOString()
  const environment = Environment.parse({ ...input.data, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
  environments.set(environment.environmentDomain, environment)

  return context.json(environment, 201)
})

export default hedra
```

The environment routes follow the tenant routes, with two differences:

- The request names the tenant by its `tenantDomain`, and the app refuses a tenant it doesn't have.
- `environmentDomainValidator` checks that `environmentDomain` is one label under that tenant's domain.

## Check your work

Start the app:

```sh
bun run examples/tutorial/03-environments.ts
```

The app keeps tenants in memory, so add Acme again in a second terminal:

```sh
curl -X POST http://localhost:3000/tenants \
  -H 'content-type: application/json' \
  -d '{"name":"Acme Widgets","tenantDomain":"acme.hedra.local"}'
```

Give Acme a development environment:

```sh
curl -X POST http://localhost:3000/environments \
  -H 'content-type: application/json' \
  -d '{"name":"Development","environmentDomain":"dev.acme.hedra.local","tenantDomain":"acme.hedra.local"}'
```

The app returns the environment. Your `id` and timestamps differ:

```json
{"id":"0b6f2d4e-3c8a-4e9b-8d1f-6a7b8c9d0e1f","name":"Development","createdAt":"2026-10-28T09:35:00.000Z","updatedAt":"2026-10-28T09:35:00.000Z","environmentDomain":"dev.acme.hedra.local","tenantDomain":"acme.hedra.local"}
```

Try an environment domain that sits under a different tenant:

```sh
curl -X POST http://localhost:3000/environments \
  -H 'content-type: application/json' \
  -d '{"name":"Development","environmentDomain":"dev.other.hedra.local","tenantDomain":"acme.hedra.local"}'
```

```json
{"errors":["Invalid environment domain"]}
```

Try a tenant the app doesn't have:

```sh
curl -X POST http://localhost:3000/environments \
  -H 'content-type: application/json' \
  -d '{"name":"Development","environmentDomain":"dev.globex.hedra.local","tenantDomain":"globex.hedra.local"}'
```

```json
{"errors":["Unknown tenant domain"]}
```

Stop the app with Ctrl+C.

## What you learned

An **environment** is the smallest separation inside a tenant. It is usually `dev`, `test` or `prod`, and it can also be a brand or a use case. Its **environment domain** is one label under its tenant's domain, and the record keeps that tenant domain too.

`Environment` extends `Resource`, like `Tenant`. Its schema checks that both fields are domains. `environmentDomainValidator` checks that one sits under the other. Because the schema has no check that spans fields, `Environment.omit` works and gives you `NewEnvironment`.

Next: [How to define a model](../guides/data-and-models/define-a-model.md)
