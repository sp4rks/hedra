import { z } from 'zod'

import type { ConfigDefinitions } from '#config'

export const deploymentVariables = {
  HEDRA_DEPLOYMENT_DOMAIN: {
    name: 'deploymentDomain',
    default: 'hedra.local',
    options: 'The top level domain name to be used for the deployment',
    description: 'The root domain name that will be used for all deployment-related operations',
    schema: z.string().regex(z.regexes.domain),
  },
  HEDRA_DEPLOYMENT_API_DOMAIN: {
    name: 'deploymentApiDomain',
    default: 'deployment.hedra.local',
    options: 'The domain name that will be used for the deployment API',
    description: 'The domain name that will be used for the deployment API',
    schema: z.string().regex(z.regexes.domain),
  },
  HEDRA_DEPLOYMENT_DOCS_DOMAIN: {
    name: 'deploymentDocsDomain',
    default: 'docs.hedra.local',
    options: 'The domain name that will be used for the docs API',
    description: 'The domain name that will be used for the docs API',
    schema: z.string().regex(z.regexes.domain),
  },
} as const satisfies ConfigDefinitions
