import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PERMANENT_AUTH_BAN_DURATION, readAccountAuthState } from '@/lib/account-auth-state'

// Member account deletion — the server-only half. close_my_account()
// (docs/sql/2026-10-16-account-lifecycle.sql) runs first under the
// member's OWN session: it closes the account and deletes/de-identifies
// their data atomically, and returns the member-owned storage objects to
// remove. Everything here then runs with the service role, strictly
// server-side, for the one user id the caller's own session resolved to:
//   1. remove those storage objects (batched per bucket);
//   2. retire the Auth identity. Tempa's own state decides how
//      (docs/sql/2026-10-25-account-auth-state.sql):
//        - voluntary deletion (no active suspension, no permanent ban):
//          Supabase soft delete — the Auth row and its id stay (so every
//          foreign key and retained record is untouched) but its email
//          and Google identity are replaced with salted hashes and its
//          sessions, tokens and factors are removed. The old account can
//          never be signed into again, and the same email / Google
//          account can create a brand-new account later;
//        - deleted while suspended or permanently banned: Auth-banned
//          with the identity kept, so deleting cannot be used to escape
//          the sanction by re-registering.
//      Reports, Safety cases and restriction are NOT sanctions here.
// Both steps are idempotent. A failure never reopens anything: the
// account is already closed in the database before either runs, and
// the failure is recorded on account_closures for a retry. If that
// record itself is refused, the refusal is logged and returned too.

export const DELETE_CONFIRMATION = 'DELETE'

/** ~100 years — Supabase Auth has no "forever"; this is permanent in practice. */
export const CLOSED_ACCOUNT_BAN_DURATION = PERMANENT_AUTH_BAN_DURATION

export type ClosureStorageObjects = {
  'profile-marks'?: string[]
  'dispatch-photos'?: string[]
}

const REMOVE_BATCH = 100
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Defence in depth: only ever remove objects that belong to THIS member
 * in the two member-owned buckets. Letter photos (shared correspondence),
 * postcard artwork and announcement images are never eligible. */
export function eligibleStorageObjects(userId: string, objects: ClosureStorageObjects | null | undefined) {
  const marks = (objects?.['profile-marks'] ?? []).filter((name) => new RegExp(`^${UUID}\\.png$`).test(name))
  const photos = (objects?.['dispatch-photos'] ?? []).filter(
    (path) => path.startsWith(`${userId}/`) && !path.includes('..') && path.split('/').length === 2
  )
  return { 'profile-marks': marks, 'dispatch-photos': photos }
}

export async function removeClosedAccountStorage(
  service: SupabaseClient,
  userId: string,
  objects: ClosureStorageObjects | null | undefined
): Promise<string | null> {
  const eligible = eligibleStorageObjects(userId, objects)
  for (const bucket of ['profile-marks', 'dispatch-photos'] as const) {
    const paths = eligible[bucket]
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const { error } = await service.storage.from(bucket).remove(paths.slice(i, i + REMOVE_BATCH))
      if (error) return `storage:${bucket}:${error.message}`
    }
  }
  return null
}

/** How the Auth identity was retired: 'retired' = soft-deleted (the
 * person may return with a new account); 'banned' = banned with the
 * identity kept (sanctioned, or the safe fallback). */
export type AuthRetirement = 'retired' | 'banned'

export async function disableClosedAuthUser(
  service: SupabaseClient,
  userId: string
): Promise<{ mode: AuthRetirement | null; error: string | null }> {
  const ban = { ban_duration: CLOSED_ACCOUNT_BAN_DURATION, user_metadata: { account_closed: true } }
  const state = await readAccountAuthState(service, userId)

  if (state === 'deleted') {
    const { error } = await service.auth.admin.deleteUser(userId, true)
    if (!error) return { mode: 'retired', error: null }
    // Never leave the closed account able to sign in because the soft
    // delete was refused: fall back to the ban and report it for retry.
    const { error: banError } = await service.auth.admin.updateUserById(userId, ban)
    if (!banError) return { mode: 'banned', error: `auth:not_retired:${error.message}` }
    return { mode: null, error: `auth:${banError.message}` }
  }

  // Sanctioned ('deleted_suspended' / 'permanently_banned'), or the state
  // could not be read / is unexpected: ban and keep the identity (safe).
  const { error } = await service.auth.admin.updateUserById(userId, ban)
  if (error) return { mode: null, error: `auth:${error.message}` }
  if (state === 'deleted_suspended' || state === 'permanently_banned') return { mode: 'banned', error: null }
  return { mode: 'banned', error: `auth:state_${state ?? 'unreadable'}` }
}

export type FinalizeResult = {
  storageCleaned: boolean
  authDisabled: boolean
  authMode: AuthRetirement | null
  error: string | null
}

export async function finalizeAccountClosure(
  service: SupabaseClient,
  userId: string,
  objects: ClosureStorageObjects | null | undefined
): Promise<FinalizeResult> {
  const storageError = await removeClosedAccountStorage(service, userId, objects)
  const { mode: authMode, error: authError } = await disableClosedAuthUser(service, userId)
  // Either retirement mode means the old account can no longer sign in.
  const authDisabled = authMode !== null
  const error = [storageError, authError].filter(Boolean).join(' | ') || null

  const now = new Date().toISOString()
  const { error: recordError } = await service
    .from('account_closures')
    .update({
      ...(storageError ? {} : { storage_cleaned_at: now }),
      ...(authDisabled ? { auth_disabled_at: now } : {}),
      last_error: error,
    })
    .eq('user_id', userId)
  if (recordError) {
    // Without this, a refused write (e.g. a missing service_role grant)
    // left auth_disabled_at NULL on banned accounts with no trace.
    console.error('[account-deletion] closure progress not recorded', {
      userId,
      code: recordError.code ?? null,
      message: recordError.message,
    })
  }
  const recordFailure = recordError ? `record:${recordError.code ?? 'unknown'}:${recordError.message}` : null

  return {
    storageCleaned: storageError === null,
    authDisabled,
    authMode,
    error: [error, recordFailure].filter(Boolean).join(' | ') || null,
  }
}
