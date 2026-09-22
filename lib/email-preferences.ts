import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The member-facing side of docs/sql/2026-10-01-arrival-email-
 * delivery.sql's arrival_email_preferences table. Mirrors
 * lib/profile-interests.ts's shape: a self-scoped table read directly
 * (RLS-limited to the caller's own row), writes only through a
 * SECURITY DEFINER RPC keyed on auth.uid().
 *
 * A member with no row yet reads back `enabled: true` — the table only
 * needs a row once someone has changed the default at least once; see
 * the migration's own column default. A genuine SELECT failure is a
 * SEPARATE, distinguishable outcome (independent audit correction —
 * these two cases used to collapse to the same `true`, which meant a
 * database error could silently render as an authoritative "email
 * arrival notifications: on" instead of a recoverable error).
 */

export type ArrivalEmailPreferenceError = { message: string; code?: string }

export type ArrivalEmailPreferenceResult =
  | { ok: true; enabled: boolean }
  | { ok: false; error: ArrivalEmailPreferenceError }

/** The current viewer's own arrival-email preference. "No row" reads
 * back `{ ok: true, enabled: true }` (the product default); an actual
 * SELECT error reads back `{ ok: false, error }` — callers must not
 * treat the two the same way. See app/you/notifications/page.tsx for
 * how the read side renders the error case instead of guessing. */
export async function getArrivalEmailPreference(
  supabase: SupabaseClient,
  userId: string
): Promise<ArrivalEmailPreferenceResult> {
  const { data, error } = await supabase
    .from('arrival_email_preferences')
    .select('arrival_emails_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return { ok: false, error: { message: error.message, code: error.code } }
  }
  if (!data) {
    return { ok: true, enabled: true }
  }
  return { ok: true, enabled: Boolean((data as { arrival_emails_enabled: boolean }).arrival_emails_enabled) }
}

export type SetArrivalEmailPreferenceError = { message: string; code?: string } | null

export async function setArrivalEmailPreference(
  supabase: SupabaseClient,
  enabled: boolean
): Promise<{ error: SetArrivalEmailPreferenceError }> {
  const { error } = await supabase.rpc('set_arrival_email_preference', { p_enabled: enabled })
  if (error) {
    return { error: { message: error.message, code: error.code } }
  }
  return { error: null }
}
