import { z } from 'zod'

/** A host name, trimmed and lowercased. */
export const Domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(z.regexes.domain)
  .describe('A host name')
  .meta({ example: 'platformname.com' })

export type Domain = z.infer<typeof Domain>

/**
 * Returns a domain schema that reports `message` when the value is not a domain.
 * The copy reuses `Domain`'s trim, lowercase and pattern, and keeps its description and metadata.
 * The pattern check is shared by every clone, so the message lives on this schema rather than on that check.
 */
export function domainReporting(message: string): typeof Domain {
  return Domain.clone({ ...Domain.def, error: () => message }, { parent: true })
}

/** Reads `value` as a domain, or returns undefined when `value` is not one. */
function readDomain(value: string): string | undefined {
  const parsed = Domain.safeParse(value)
  if (!parsed.success) return undefined

  return parsed.data
}

/**
 * Returns the single label of `value` directly under `parent`.
 * The label is undefined when `value` is `parent`, is more than one label deep, or does not end in `.` plus `parent`.
 */
function singleLabelUnder(value: string, parent: string): string | undefined {
  const suffix = `.${parent}`
  if (!value.endsWith(suffix)) return undefined

  const label = value.slice(0, -suffix.length)
  if (label.length === 0 || label.includes('.')) return undefined

  return label
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
  if (singleLabelUnder(candidate, root) === undefined) return false

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

  return singleLabelUnder(candidate, tenant) !== undefined
}
