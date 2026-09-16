import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_INTERESTS, isValidInterestKey } from './interests'

/**
 * Board Personalization Phase 2B — the thin DB-backed layer over
 * lib/interests.ts's pure taxonomy. See docs/sql/2026-09-27-topical-
 * interests.sql for the schema (public.interests, public.
 * interest_topic_aliases, public.profile_interests, public.
 * set_profile_interests).
 */

/** The current viewer's own selected Interest keys — self-scoped by
 * profile_interests_select_own RLS, so this can never return another
 * member's selection. An empty array (never an error) for a viewer who
 * hasn't chosen any yet, or isn't signed in — the zero-interest state
 * every caller must degrade gracefully for. */
export async function getProfileInterestKeys(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data } = await supabase
    .from('profile_interests')
    .select('interest_key')
    .eq('viewer_user_id', userId)

  return (data ?? []).map((row) => row.interest_key as string)
}

export type SetProfileInterestsError = { message: string; code?: string } | null

/**
 * Atomically replaces the viewer's ENTIRE Interest selection via the
 * set_profile_interests RPC (delete-then-insert in one transaction, so
 * there is never a moment where a save-in-progress leaves the viewer
 * with a partial/inconsistent set). Client-side filters to known,
 * valid taxonomy keys first — defense in depth; the RPC's own foreign
 * key to public.interests(key) is the actual authority.
 */
export async function setProfileInterests(
  supabase: SupabaseClient,
  interestKeys: string[]
): Promise<{ error: SetProfileInterestsError }> {
  const validKeys = [...new Set(interestKeys.filter(isValidInterestKey))].slice(0, MAX_INTERESTS)

  const { error } = await supabase.rpc('set_profile_interests', {
    p_interest_keys: validKeys,
  })

  if (error) {
    return { error: { message: error.message, code: error.code } }
  }
  return { error: null }
}
