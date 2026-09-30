'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { saveMyTempaLanguage } from '@/lib/reading-language-data'
import { isInterfaceLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type InterfaceLocale } from '@/i18n/config'

/**
 * Tempa interface language. Dictionary-based only: nothing here touches the
 * member-content translation provider, translation quota or public cache.
 */

export type LocaleActionResult = { ok: true; locale: InterfaceLocale } | { ok: false }

export function localeCookieOptions() {
  return {
    path: '/',
    sameSite: 'lax' as const,
    maxAge: LOCALE_COOKIE_MAX_AGE,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  }
}

export async function writeLocaleCookie(locale: InterfaceLocale) {
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, localeCookieOptions())
}

/** Pre-sign-in selector: explicit device/browser choice only, no DB write. */
export async function setInterfaceLanguage(code: string): Promise<LocaleActionResult> {
  if (!isInterfaceLocale(code)) return { ok: false }
  await writeLocaleCookie(code)
  return { ok: true, locale: code }
}

/**
 * Authenticated primary language choice. One database RPC atomically saves
 * interface_locale + reading_language + first confirmation, then the cookie
 * changes. A failed durable save leaves the browser language untouched.
 */
export async function chooseTempaLanguage(code: string): Promise<LocaleActionResult> {
  if (!isInterfaceLocale(code)) return { ok: false }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false }

  const saved = await saveMyTempaLanguage(supabase, code)
  if (!saved.ok) return { ok: false }

  await writeLocaleCookie(code)
  revalidatePath('/', 'layout')
  return { ok: true, locale: code }
}
