/**
 * Tempa's INTERFACE languages — the language of Tempa's own menus, buttons
 * and system copy, from reviewed local dictionaries (messages/*.json).
 *
 * This is deliberately separate from the Reading language registry
 * (lib/reading-languages.ts, 108 provider languages), which decides what
 * Tempa translates OTHER MEMBERS' writing into through the translation
 * service. Tempa's interface is never machine-translated at runtime.
 *
 * Adding an interface language = one entry here + one reviewed dictionary.
 * No schema change: the interface choice lives in the `tempa_locale` cookie.
 *
 * Client-safe: no server-only imports.
 */

export type LocaleDirection = 'ltr' | 'rtl'

export const INTERFACE_LOCALES = [
  { code: 'en', nativeName: 'English', direction: 'ltr' },
  { code: 'fr', nativeName: 'Français', direction: 'ltr' },
  { code: 'es', nativeName: 'Español', direction: 'ltr' },
  { code: 'pt', nativeName: 'Português', direction: 'ltr' },
] as const satisfies readonly { code: string; nativeName: string; direction: LocaleDirection }[]

export type InterfaceLocale = (typeof INTERFACE_LOCALES)[number]['code']

export const DEFAULT_LOCALE: InterfaceLocale = 'en'

/** The explicit interface choice. Set only by a member's own selection. */
export const LOCALE_COOKIE = 'tempa_locale'
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

const CODES: readonly string[] = INTERFACE_LOCALES.map((locale) => locale.code)

/** Exact allowlist match only — never a prefix, path or case-folded guess. */
export function isInterfaceLocale(value: unknown): value is InterfaceLocale {
  return typeof value === 'string' && CODES.includes(value)
}

export function localeDirection(locale: InterfaceLocale): LocaleDirection {
  return INTERFACE_LOCALES.find((entry) => entry.code === locale)?.direction ?? 'ltr'
}

export function localeNativeName(locale: InterfaceLocale): string {
  return INTERFACE_LOCALES.find((entry) => entry.code === locale)?.nativeName ?? 'English'
}

/**
 * The best supported interface language in an Accept-Language header, by
 * q-weight then order (`fr-CA` → fr, `pt-BR` → pt). A tag with q=0 is a
 * refusal. Language tags only — a region subtag never selects a language on
 * its own, and nothing about country or location is consulted.
 */
export function matchAcceptLanguage(header: string | null | undefined): InterfaceLocale | null {
  if (!header) return null
  const ranked = header
    .split(',')
    .slice(0, 32)
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number(qParam.slice(2)) : 1
      return { primary: tag.trim().toLowerCase().split('-')[0], q: Number.isFinite(q) ? q : 0, index }
    })
    .filter((entry) => entry.primary && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)

  for (const entry of ranked) {
    if (isInterfaceLocale(entry.primary)) return entry.primary
  }
  return null
}

/**
 * Interface language for a request:
 *   1. a valid explicit `tempa_locale` cookie;
 *   2. otherwise a supported Accept-Language match — used for this render
 *      only, never written anywhere;
 *   3. otherwise English.
 * An unknown/tampered cookie is ignored (falls through), never trusted.
 */
export function resolveInterfaceLocale(input: {
  cookie: string | null | undefined
  acceptLanguage: string | null | undefined
}): InterfaceLocale {
  if (isInterfaceLocale(input.cookie)) return input.cookie
  return matchAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE
}
