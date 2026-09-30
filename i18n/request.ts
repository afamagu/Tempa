import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import es from '../messages/es.json'
import pt from '../messages/pt.json'
import { LOCALE_COOKIE, resolveInterfaceLocale, type InterfaceLocale } from './config'

/**
 * next-intl request configuration, WITHOUT locale-based routing: URLs never
 * carry a locale (/sign-in, /home, … stay exactly as they are). The locale
 * comes from the explicit `tempa_locale` cookie, else a non-persistent
 * Accept-Language suggestion, else English (i18n/config.ts).
 *
 * Dictionaries are a static map keyed by the allowlisted locale — a cookie
 * value is never used to build an import path.
 */
export const MESSAGES = { en, fr, es, pt } satisfies Record<InterfaceLocale, typeof en>

export async function resolveRequestLocale(): Promise<InterfaceLocale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  return resolveInterfaceLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  })
}

export default getRequestConfig(async () => {
  const locale = await resolveRequestLocale()
  return { locale, messages: MESSAGES[locale] }
})
