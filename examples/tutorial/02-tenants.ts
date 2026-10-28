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
