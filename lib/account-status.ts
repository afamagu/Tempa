import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Account enforcement messaging (pre-beta UX polish batch 1) — a member
 * whose send fails because they're restricted/suspended/banned
 * previously saw the same generic "Could not send your letter. Please
 * try again." as any transient failure, which wrongly implies a retry
 * could succeed. This never changes WHICH sends succeed or fail (that
 * stays entirely inside the RPCs — see docs/sql/2026-09-11-safety-
 * blocking-foundation.sql and friends) — it only lets a composer show
 * calmer, honest copy in place of the generic fallback, using
 * information the member is already entitled to know about themselves.
 */

export type AccountStatus = 'active' | 'restricted' | 'suspended' | 'banned'

/** Phase 1 — a restricted account (including RESTRICTED — PENDING REVIEW) can
 * read but not write anywhere: the database refuses every authored write
 * with this SQLSTATE (tempa_private.consume_safety_evaluation). */
export const ACCOUNT_ACTION_UNAVAILABLE_CODE = '42501'

export const ACCOUNT_RESTRICTED_MESSAGE =
  "Your account is temporarily restricted, so you can't write, reply, publish or comment right now. You can still read your correspondence."

/**
 * The CALLER's own status only. current_account_status() is documented
 * client-safe for exactly this — "a member's own client can read their
 * own status if ever needed" (see current_account_status's own SQL
 * comment) — never anyone else's, so this can never be used to probe
 * another member's enforcement state. Defaults to 'active' on any
 * error, matching the RPC's own fallback, so a transient failure here
 * never over-claims enforcement.
 */
export async function getMyAccountStatus(supabase: SupabaseClient): Promise<AccountStatus> {
  const { data, error } = await supabase.rpc('current_account_status')
  if (error || typeof data !== 'string') return 'active'
  return data as AccountStatus
}

/**
 * Calm, honest copy for a send this status FULLY blocks (a first
 * contact letter, an established-correspondence letter while suspended
 * or banned, a Dispatch publish/edit while restricted/suspended/banned)
 * — never used for 'active', and never applied to a context the status
 * doesn't actually fully block. (Phase 1: restricted now blocks every
 * authored write, so it is a full block like suspended/banned.)
 */
export function accountBlockedMessage(status: AccountStatus): string | null {
  if (status === 'restricted') return ACCOUNT_RESTRICTED_MESSAGE
  if (status === 'suspended') return 'Your account is currently suspended.'
  if (status === 'banned') return 'Your account has been banned and can no longer send letters.'
  return null
}

/** write_letter's own deliberately-ambiguous text for a blocked-pair
 * correspondence (shared, by design, with "not found" and with
 * suspended/banned — see that RPC's own comment) — mapped to equally
 * neutral, non-revealing TEMPA copy rather than the generic retry-
 * implying fallback. Never distinguishes WHO blocked whom; preserves
 * the exact same privacy guarantee the RPC's shared wording already
 * provides. */
export const CORRESPONDENCE_CLOSED_MESSAGE = 'This correspondence is no longer open to new letters.'
