import { z } from 'zod'

import type { Config } from '#config'
import { ConfigurationError } from '#errors'

export const deploymentVariables: Config = {
  HEDRA_DEPLOYMENT_DOMAIN: {
    name: 'deploymentDomain',
    default: 'hedra.local',
    options: 'The top level domain name to be used for the deployment',
    description: 'The root domain name that will be used for all deployment-related operations',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.string().regex(z.regexes.domain).parse(value)
      } catch (_error) {
        throw new ConfigurationError(500, 'configuration error', `HEDRA_DEPLOYMENT_DOMAIN has invalid value: ${value}`)
      }
    },
  },
  HEDRA_DEPLOYMENT_API_DOMAIN: {
    name: 'deploymentApiDomain',
    default: 'deployment.hedra.local',
    options: 'The domain name that will be used for the deployment API',
    description: 'The domain name that will be used for the deployment API',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.string().regex(z.regexes.domain).parse(value)
      } catch (_error) {
        throw new ConfigurationError(
          500,
          'configuration error',
          `HEDRA_DEPLOYMENT_API_DOMAIN has invalid value: ${value}`,
        )
      }
    },
  },
  HEDRA_DEPLOYMENT_DOCS_DOMAIN: {
    name: 'deploymentDocsDomain',
    default: 'docs.hedra.local',
    options: 'The domain name that will be used for the docs API',
    description: 'The domain name that will be used for the docs API',
    validate: (value: string | number | boolean) => {
      try {
        z.coerce.string().regex(z.regexes.domain).parse(value)
      } catch (_error) {
        throw new ConfigurationError(
          500,
          'configuration error',
          `HEDRA_DEPLOYMENT_DOCS_DOMAIN has invalid value: ${value}`,
        )
      }
    },
  },
}
