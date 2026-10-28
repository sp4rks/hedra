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
    return context.json({ errors: ['Environment domain is not under its tenant domain'] }, 400)
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
