import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The member-facing side of docs/sql/2026-10-01-arrival-email-
 * delivery.sql's arrival_email_preferences table. Mirrors
 * lib/profile-interests.ts's shape: a self-scoped table read directly
 * (RLS-limited to the caller's own row), writes only through a
 * SECURITY DEFINER RPC keyed on auth.uid().
 *
 * A member with no row yet reads back `true` (enabled) — the table
 * only needs a row once someone has changed the default at least once;
 * see the migration's own column default.
 */

/** The current viewer's own arrival-email preference. Defaults to
 * enabled when no row exists yet, or when not signed in. */
export async function getArrivalEmailPreference(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('arrival_email_preferences')
    .select('arrival_emails_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (!data) return true
  return Boolean((data as { arrival_emails_enabled: boolean }).arrival_emails_enabled)
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
