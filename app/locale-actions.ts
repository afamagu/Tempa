'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { saveMyReadingLanguage } from '@/lib/reading-language-data'
import { isInterfaceLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type InterfaceLocale } from '@/i18n/config'

/**
 * Tempa interface language. Dictionary-based only: nothing here touches the
 * member-content translation service, the translation quota or its cache.
 *
 * Setting the cookie inside a Server Action makes Next.js re-render the
 * current route in the same response, so the page switches language in
 * place — same URL (every ?next / ?intent / ?error kept), no navigation,
 * no form submission, client state intact.
 */

export type LocaleActionResult = { ok: true; locale: InterfaceLocale } | { ok: false }

async function writeLocaleCookie(locale: InterfaceLocale) {
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })
}

/**
 * The pre-sign-in language control. Cookie only — never a database write,
 * signed in or not. Only an allowlisted interface code is accepted.
 */
export async function setInterfaceLanguage(code: string): Promise<LocaleActionResult> {
  if (!isInterfaceLocale(code)) return { ok: false }
  await writeLocaleCookie(code)
  return { ok: true, locale: code }
}

/**
 * You → Language, the member's ONE primary choice: Tempa's interface on
 * this device AND their default translation language. The reading language
 * is saved through the existing authenticated path (set_my_reading_language,
 * keyed on auth.uid()) BEFORE the cookie changes, so a failed save changes
 * nothing.
 */
export async function chooseTempaLanguage(code: string): Promise<LocaleActionResult> {
  if (!isInterfaceLocale(code)) return { ok: false }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const saved = await saveMyReadingLanguage(supabase, code)
  if (!saved.ok) return { ok: false }

  await writeLocaleCookie(code)
  revalidatePath('/you')
  return { ok: true, locale: code }
}
