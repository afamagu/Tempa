/** Keep in step with public.is_reserved_pseudonym in the SQL migration.
 * Protect the brand and the house columnist, including appended letters or
 * numbers (Lady Larkspurr, Tempa Support), after removing spaces/hyphens. */
export const RESERVED_PSEUDONYM_PREFIXES = ['tempa', 'ladylarkspur'] as const
export const RESERVED_PSEUDONYM_MESSAGE = 'That name is reserved.'

export function isReservedPseudonym(value: string): boolean {
  const key = value.trim().toLowerCase().replace(/[ -]+/g, '')
  return RESERVED_PSEUDONYM_PREFIXES.some((prefix) => key.startsWith(prefix))
}
