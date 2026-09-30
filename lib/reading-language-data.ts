import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeReadingLanguage, readingLanguage } from './reading-languages'

// The member-facing side of docs/sql/2026-09-30-reading-language.sql. Same
// shape as lib/email-preferences.ts: the caller's own row read directly
// (RLS limits it to them), every write through a SECURITY DEFINER RPC keyed
// on auth.uid(). Nothing here reads country, location or the browser — a
// Reading language only ever exists because the member chose it.

export type ReadingLanguageResult = { ok: true; code: string | null } | { ok: false }

/** The signed-in member's own Reading language. No row (or an unknown
 * stored code) = not chosen yet. A read failure is reported separately so
 * it never renders as an authoritative "not chosen". Fail-soft if the
 * migration has not been applied yet: the table is missing → ok:false. */
export async function getMyReadingLanguage(supabase: SupabaseClient, userId: string): Promise<ReadingLanguageResult> {
  const { data, error } = await supabase
    .from('member_language_preferences')
    .select('reading_language')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return { ok: false }
  return { ok: true, code: normalizeReadingLanguage((data as { reading_language?: unknown } | null)?.reading_language) }
}

export type SaveReadingLanguageResult = { ok: true; code: string } | { ok: false; reason: 'unsupported' | 'failed' }

/** Validates against Tempa's registry BEFORE the RPC (the database only
 * checks a code's shape), so an unsupported language is never stored. */
export async function saveMyReadingLanguage(supabase: SupabaseClient, code: unknown): Promise<SaveReadingLanguageResult> {
  const language = readingLanguage(code)
  if (!language) return { ok: false, reason: 'unsupported' }
  const { data, error } = await supabase.rpc('set_my_reading_language', { p_language: language.code })
  const saved = normalizeReadingLanguage(data)
  return error || !saved ? { ok: false, reason: 'failed' } : { ok: true, code: saved }
}
