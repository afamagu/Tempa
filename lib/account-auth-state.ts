import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Tempa's own answer to "why can't this person sign in?" — never
// Supabase Auth's generic `user_banned`, which is the same for a
// permanent admin ban, a deletion during a suspension and (before
// 2026-10-25) every voluntary deletion. Read with the SERVICE ROLE
// through docs/sql/2026-10-25-account-auth-state.sql, whose functions
// are executable by service_role only.

// deleted_suspended is accepted only for compatibility with databases before
// 2026-10-02-deleted-member-return.sql; the current policy returns deleted
// for every closed account without a permanent admin ban.
export type AccountAuthState = 'permanently_banned' | 'deleted_suspended' | 'deleted' | 'suspended' | 'none'

const STATES: readonly AccountAuthState[] = ['permanently_banned', 'deleted_suspended', 'deleted', 'suspended', 'none']

/** ~100 years — Supabase Auth has no "forever"; this is permanent in practice. */
export const PERMANENT_AUTH_BAN_DURATION = '876000h'

function asState(data: unknown): AccountAuthState | null {
  return typeof data === 'string' && (STATES as readonly string[]).includes(data) ? (data as AccountAuthState) : null
}

/** null = could not be read (callers must fail safe). */
export async function readAccountAuthState(service: SupabaseClient, userId: string): Promise<AccountAuthState | null> {
  const { data, error } = await service.rpc('account_auth_state', { p_user_id: userId })
  if (error) {
    console.error('[account-auth-state] read failed', { userId, code: error.code ?? null, message: error.message })
    return null
  }
  return asState(data)
}

/** The state of the Auth user a magic link belongs to, or null if the
 * link matches no account (or the read failed). The token hash is never
 * logged. */
export async function readAccountAuthStateForEmailLink(
  service: SupabaseClient,
  tokenHash: string
): Promise<AccountAuthState | null> {
  const { data, error } = await service.rpc('account_auth_state_for_email_link', { p_token_hash: tokenHash })
  if (error) {
    console.error('[account-auth-state] link lookup failed', { code: error.code ?? null, message: error.message })
    return null
  }
  return asState(data)
}

/** The /sign-in `?error=` for a refused sign-in. Only a voluntary
 * deletion is ever invited to create a new account; a permanent ban is
 * named as one; anything we cannot attribute stays neutral — never
 * "your link expired", never "banned" unless Tempa says so. */
export type RefusedSignInError = 'account_deleted' | 'account_deleted_unavailable' | 'account_banned' | 'account_unavailable'

export function refusedSignInError(state: AccountAuthState | null): RefusedSignInError {
  if (state === 'deleted') return 'account_deleted'
  if (state === 'deleted_suspended') return 'account_deleted_unavailable'
  if (state === 'permanently_banned') return 'account_banned'
  return 'account_unavailable'
}

/**
 * Make the Auth ban match Tempa's permanent-ban decision for one member,
 * after an admin changed their status. Derived ONLY from the database,
 * never from the caller's claim, so calling it can only ever bring Auth
 * into line with Tempa:
 *   permanently_banned -> Auth-banned (identity kept, so the same email /
 *                         Google account cannot simply re-register);
 *   deleted*           -> untouched (account deletion owns that identity);
 *   anything else      -> Auth ban lifted (suspension and restriction
 *                         never block sign-in; Tempa gates them in-app).
 */
export async function syncAuthBanWithTempa(service: SupabaseClient, userId: string): Promise<string | null> {
  const state = await readAccountAuthState(service, userId)
  if (state === null) return 'state_unreadable'
  if (state === 'deleted' || state === 'deleted_suspended') return null
  const { error } = await service.auth.admin.updateUserById(userId, {
    ban_duration: state === 'permanently_banned' ? PERMANENT_AUTH_BAN_DURATION : 'none',
  })
  if (error) {
    console.error('[account-auth-state] auth ban sync failed', { userId, state, message: error.message })
    return `auth:${error.message}`
  }
  return null
}
