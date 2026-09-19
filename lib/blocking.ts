import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Member-to-member blocking — Safety & Trust Checkpoint 1B, scoped in
 * Checkpoint 1C (see docs/sql/2026-09-11-safety-blocking-foundation.sql
 * and docs/sql/2026-09-12-scoped-blocking-and-fixes.sql for the full
 * schema/RPC design this wraps). A directional stored record (A blocks
 * B) carrying a `scope` — every actual enforcement point (profile
 * visibility, Dispatch/Board visibility, Keep, letter-sending,
 * photo-Moment signing) lives server-side in RLS policies and RPCs —
 * this module is a thin client wrapper, never the authorization
 * boundary itself.
 *
 * Two scopes, both mutual in effect once created:
 * - 'letters' ("Stop letters") — neither side may start or continue
 *   private correspondence; everything public (profiles, Question
 *   answers, Discovery, Dispatches/Board, Keep) is unaffected.
 * - 'full' ("Block everywhere") — the previous single-mode behavior:
 *   mutual app-wide public invisibility, no new correspondence, and
 *   Keep is removed in both directions atomically.
 *
 * Never exposed: a block count, a "blocked by" list, or any signal to
 * the blocked member that they were blocked. There is deliberately no
 * `isBlockedPair`/`isBlocked` export here at all — those checks exist
 * only as tempa_private.is_blocked_pair / is_correspondence_blocked_pair,
 * non-API-exposed functions used internally by RLS policies and RPCs,
 * never callable by a client. A member can only ever see their OWN
 * outgoing blocks (getBlockedUsers/getBlockedProfiles below), never
 * whether someone has blocked them.
 */

export type BlockScope = 'letters' | 'full'

export type BlockedUser = {
  blockedId: string
  scope: BlockScope
  createdAt: string
}

export type BlockError = { message: string; code?: string } | null

/**
 * Blocks a member with the given scope — defaults to 'full' (the
 * original, coarser behavior) when omitted. Idempotent: calling this
 * again for an already-blocked pair simply sets the scope to whatever
 * was just requested — this is how upgrading 'letters' -> 'full', or
 * downgrading 'full' -> 'letters', both happen; there is no separate
 * "upgrade" RPC. Only a resulting scope of 'full' atomically removes
 * any existing Keep relationship between the pair in both directions,
 * server-side, in the same transaction (see block_user in the
 * migration) — a 'letters' block never touches Keep, and a downgrade
 * from 'full' never restores a Keep row a prior full block removed.
 */
export async function blockUser(
  supabase: SupabaseClient,
  blockedId: string,
  scope: BlockScope = 'full'
): Promise<{ error: BlockError }> {
  const { error } = await supabase.rpc('block_user', { p_blocked_id: blockedId, p_scope: scope })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/**
 * Removes a block the caller themselves created, regardless of its
 * scope. Never restores any Keep relationship that existed before a
 * 'full' block removed it — that state is gone permanently once
 * block_user cascades it away.
 */
export async function unblockUser(
  supabase: SupabaseClient,
  blockedId: string
): Promise<{ error: BlockError }> {
  const { error } = await supabase.rpc('unblock_user', { p_blocked_id: blockedId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/**
 * The caller's own current block scope against one specific member, or
 * null if no block exists — used by BlockButton to render the correct
 * state (no block / letters-only / full) for a specific profile or
 * correspondence, without fetching the caller's entire blocked list.
 * RLS (blocked_users_select_own) already scopes this to rows where the
 * caller is blocker_id, so this can never reveal whether the OTHER
 * party has blocked the caller.
 */
export async function getBlockScope(
  supabase: SupabaseClient,
  blockedId: string
): Promise<BlockScope | null> {
  const { data } = await supabase
    .from('blocked_users')
    .select('scope')
    .eq('blocked_id', blockedId)
    .maybeSingle()

  return (data as { scope: BlockScope } | null)?.scope ?? null
}

/**
 * Every member the caller has blocked, with scope — for Settings →
 * Safety → Blocked minds only. RLS (blocked_users_select_own) already
 * scopes this to rows where the caller is blocker_id; a blocked party
 * has no policy that would ever let this same query return rows naming
 * them as blocked_id for someone ELSE's block of them.
 */
export async function getBlockedUsers(supabase: SupabaseClient): Promise<BlockedUser[]> {
  const { data } = await supabase
    .from('blocked_users')
    .select('blocked_id, scope, created_at')
    .order('created_at', { ascending: false })

  return ((data ?? []) as { blocked_id: string; scope: BlockScope; created_at: string }[]).map((row) => ({
    blockedId: row.blocked_id,
    scope: row.scope,
    createdAt: row.created_at,
  }))
}

export type BlockedProfile = {
  id: string
  pseudonym: string
  country: string | null
  scope: BlockScope
  createdAt: string
  markId: string | null
}

/**
 * Blocked-minds list WITH a resolved pseudonym/country/scope — via
 * get_blocked_profiles(), not a plain public_profiles read. The
 * full-block-aware public_profiles view deliberately excludes a fully
 * blocked pair from each other's view of it, which would otherwise
 * make it impossible for a member to see the pseudonym of someone they
 * themselves fully blocked, on their own management screen (a
 * letters-only block never has this problem, since public_profiles is
 * unaffected by it — get_blocked_profiles works identically for both
 * scopes regardless). get_blocked_profiles() is the narrow,
 * self-scoped exception: it only ever returns rows the caller's own
 * blocked_users rows already name.
 */
export async function getBlockedProfiles(supabase: SupabaseClient): Promise<BlockedProfile[]> {
  const { data } = await supabase.rpc('get_blocked_profiles')
  return (
    (data ?? []) as { id: string; pseudonym: string; country: string | null; scope: BlockScope; created_at: string; mark_id?: string | null }[]
  ).map((row) => ({ id: row.id, pseudonym: row.pseudonym, country: row.country, scope: row.scope, createdAt: row.created_at, markId: row.mark_id ?? null }))
}
