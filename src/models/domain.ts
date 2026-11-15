import { z } from 'zod'

export const Domain = z.string().trim().toLowerCase().regex(z.regexes.domain)

/** Checks that a canonical domain has exactly one label beneath its parent. */
export function isDirectDomain(domain: string, parent: string): boolean {
  const suffix = `.${parent.toLowerCase()}`
  const label = domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : ''

  return label.length > 0 && !label.includes('.')
}
