import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Member account deletion — the server-only half. close_my_account()
// (docs/sql/2026-10-16-account-lifecycle.sql) runs first under the
// member's OWN session: it closes the account and deletes/de-identifies
// their data atomically, and returns the member-owned storage objects to
// remove. Everything here then runs with the service role, strictly
// server-side, for the one user id the caller's own session resolved to:
//   1. remove those storage objects (batched per bucket);
//   2. permanently disable the Auth user (banned; email scrubbed unless
//      Safety history requires keeping it to prevent ban evasion).
// Both steps are idempotent. A failure never reopens anything: the
// account is already closed in the database before either runs, and
// the failure is recorded on account_closures for a retry.

export const DELETE_CONFIRMATION = 'DELETE'

/** ~100 years — Supabase Auth has no "forever"; this is permanent in practice. */
export const CLOSED_ACCOUNT_BAN_DURATION = '876000h'

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

/** Keep the sign-in email on file only when Safety history exists, so a
 * restricted/suspended/banned or reported member cannot delete and
 * immediately re-register with the same address. Otherwise it is
 * replaced with a non-deliverable tombstone. */
async function hasSafetyHistory(service: SupabaseClient, userId: string): Promise<boolean> {
  const [enforcement, reports, cases] = await Promise.all([
    service.from('account_enforcement_state').select('status').eq('user_id', userId).maybeSingle(),
    service.from('reports').select('id', { count: 'exact', head: true }).eq('reported_user_id', userId),
    service.from('safety_cases').select('id', { count: 'exact', head: true }).eq('subject_user_id', userId),
  ])
  if (enforcement.error || reports.error || cases.error) return true // unsure -> retain (safer)
  return (enforcement.data?.status ?? 'active') !== 'active' || (reports.count ?? 0) > 0 || (cases.count ?? 0) > 0
}

export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@account-closed.invalid`
}

export async function disableClosedAuthUser(service: SupabaseClient, userId: string): Promise<string | null> {
  const retainEmail = await hasSafetyHistory(service, userId)
  const base = { ban_duration: CLOSED_ACCOUNT_BAN_DURATION, user_metadata: { account_closed: true } }
  const { error } = await service.auth.admin.updateUserById(
    userId,
    retainEmail ? base : { ...base, email: tombstoneEmail(userId), email_confirm: true }
  )
  if (!error) return null
  if (!retainEmail) {
    // Never leave the account able to sign in because an email rewrite
    // was refused: fall back to the ban alone and report it.
    const { error: banError } = await service.auth.admin.updateUserById(userId, base)
    if (!banError) return `auth:email_not_scrubbed:${error.message}`
    return `auth:${banError.message}`
  }
  return `auth:${error.message}`
}

export type FinalizeResult = { storageCleaned: boolean; authDisabled: boolean; error: string | null }

export async function finalizeAccountClosure(
  service: SupabaseClient,
  userId: string,
  objects: ClosureStorageObjects | null | undefined
): Promise<FinalizeResult> {
  const storageError = await removeClosedAccountStorage(service, userId, objects)
  const authError = await disableClosedAuthUser(service, userId)
  // "email_not_scrubbed" still means the account is disabled.
  const authDisabled = authError === null || authError.startsWith('auth:email_not_scrubbed')
  const error = [storageError, authError].filter(Boolean).join(' | ') || null

  const now = new Date().toISOString()
  await service
    .from('account_closures')
    .update({
      ...(storageError ? {} : { storage_cleaned_at: now }),
      ...(authDisabled ? { auth_disabled_at: now } : {}),
      last_error: error,
    })
    .eq('user_id', userId)

  return { storageCleaned: storageError === null, authDisabled, error }
}
