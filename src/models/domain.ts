import { z } from 'zod'

/** Returns a trimmed, lowercased domain string. `message` is the error when the value is not a domain. */
export function domainSchema(message?: string) {
  return z.string().trim().toLowerCase().regex(z.regexes.domain, message)
}

/** A host name, trimmed and lowercased. */
export const Domain = domainSchema().describe('A host name').meta({ example: 'platformname.com' })

export type Domain = z.infer<typeof Domain>

/** Reads `value` as a domain, or returns undefined when `value` is not one. */
function readDomain(value: string): string | undefined {
  const parsed = Domain.safeParse(value)
  if (!parsed.success) return undefined

  return parsed.data
}

/**
 * Reports whether `value` is exactly one label under `parent`.
 * Returns false when `value` is `parent`, is more than one label deep, or does not end in `.` plus `parent`.
 */
function isOneLabelUnder(value: string, parent: string): boolean {
  const suffix = `.${parent}`
  if (!value.endsWith(suffix)) return false

  const label = value.slice(0, -suffix.length)
  if (label.length === 0 || label.includes('.')) return false

  return true
}

/**
 * Reports whether `value` is the deployment domain.
 * Both arguments are read as domains first, so the comparison ignores case and surrounding spaces.
 */
export function deploymentDomainValidator(value: string, deploymentDomain: string): boolean {
  const candidate = readDomain(value)
  const root = readDomain(deploymentDomain)
  if (candidate === undefined || root === undefined) return false

  return candidate === root
}

/**
 * Reports whether `value` is one label under `deploymentDomain` and is not a reserved host.
 * `reservedDomains` is required so the hosts this deployment already serves are not forgotten.
 * Pass an empty list when none are reserved.
 * Every argument is read as a domain first. A value that is not a domain returns false.
 */
export function tenantDomainValidator(
  value: string,
  deploymentDomain: string,
  reservedDomains: readonly string[],
): boolean {
  const candidate = readDomain(value)
  const root = readDomain(deploymentDomain)
  if (candidate === undefined || root === undefined) return false
  if (!isOneLabelUnder(candidate, root)) return false

  for (const reserved of reservedDomains) {
    if (readDomain(reserved) === candidate) return false
  }

  return true
}

/**
 * Reports whether `value` is one label under `tenantDomain`.
 * Both arguments are read as domains first, so the comparison ignores case and surrounding spaces.
 */
export function environmentDomainValidator(value: string, tenantDomain: string): boolean {
  const candidate = readDomain(value)
  const tenant = readDomain(tenantDomain)
  if (candidate === undefined || tenant === undefined) return false

  return isOneLabelUnder(candidate, tenant)
}
