import type { SupabaseClient } from '@supabase/supabase-js'
import { isInterfaceLocale, type InterfaceLocale } from '@/i18n/config'
import { normalizeReadingLanguage, readingLanguage } from './reading-languages'

// The member-facing side of the private language-preference table. Reads are
// self-scoped by RLS; writes go through SECURITY DEFINER RPCs keyed on
// auth.uid(). Nothing here consults country/location.

export type ReadingLanguageResult = { ok: true; code: string | null } | { ok: false }

/** The signed-in member's own Translation language. */
export async function getMyReadingLanguage(supabase: SupabaseClient, userId: string): Promise<ReadingLanguageResult> {
  const { data, error } = await supabase
    .from('member_language_preferences')
    .select('reading_language')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { ok: false }
  return { ok: true, code: normalizeReadingLanguage((data as { reading_language?: unknown } | null)?.reading_language) }
}

export type MyLanguagePreferencesResult =
  | {
      ok: true
      interfaceLocale: InterfaceLocale | null
      readingLanguage: string | null
      confirmed: boolean
    }
  | { ok: false }

/**
 * Reads the complete private language state. A migration-not-yet-applied
 * error is fail-soft (ok:false), allowing app deploy before SQL without
 * forcing existing members into a broken onboarding loop.
 */
export async function getMyLanguagePreferences(
  supabase: SupabaseClient,
  userId: string
): Promise<MyLanguagePreferencesResult> {
  const { data, error } = await supabase
    .from('member_language_preferences')
    .select('interface_locale, reading_language, language_confirmed_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return { ok: false }
  const row = data as {
    interface_locale?: unknown
    reading_language?: unknown
    language_confirmed_at?: unknown
  } | null

  return {
    ok: true,
    interfaceLocale: isInterfaceLocale(row?.interface_locale) ? row.interface_locale : null,
    readingLanguage: normalizeReadingLanguage(row?.reading_language),
    confirmed: typeof row?.language_confirmed_at === 'string' && row.language_confirmed_at.length > 0,
  }
}

export type SaveReadingLanguageResult = { ok: true; code: string } | { ok: false; reason: 'unsupported' | 'failed' }

/** Validates against Tempa's registry BEFORE the RPC. */
export async function saveMyReadingLanguage(supabase: SupabaseClient, code: unknown): Promise<SaveReadingLanguageResult> {
  const language = readingLanguage(code)
  if (!language) return { ok: false, reason: 'unsupported' }
  const { data, error } = await supabase.rpc('set_my_reading_language', { p_language: language.code })
  const saved = normalizeReadingLanguage(data)
  return error || !saved ? { ok: false, reason: 'failed' } : { ok: true, code: saved }
}

export type SaveTempaLanguageResult = { ok: true; locale: InterfaceLocale } | { ok: false }

/** Atomic primary-language save: interface + initial/default translation language + confirmation. */
export async function saveMyTempaLanguage(
  supabase: SupabaseClient,
  locale: InterfaceLocale
): Promise<SaveTempaLanguageResult> {
  const { data, error } = await supabase.rpc('set_my_tempa_language', { p_locale: locale })
  return error || !isInterfaceLocale(data) ? { ok: false } : { ok: true, locale: data }
}
