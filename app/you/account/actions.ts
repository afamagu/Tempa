'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DELETE_CONFIRMATION, finalizeAccountClosure, type ClosureStorageObjects } from '@/lib/account-deletion'

export type DeleteAccountResult = { ok: false; error: string }

const GENERIC_FAILURE = 'We couldn’t delete your account. Nothing has been changed — please try again.'
const STAFF_MESSAGES = ['Staff accounts are closed by Tempa administrators.', 'This account created official Tempa content and is closed by Tempa administrators.']

/**
 * Delete (close) the SIGNED-IN member's own account. There is no target
 * parameter: the member is whoever the request's own session resolves
 * to, and close_my_account() itself re-derives that from auth.uid().
 *
 *  1. close_my_account() under the member's session — atomic: closes the
 *     account and deletes/de-identifies their data. If this fails,
 *     nothing changed and the member is told so.
 *  2. Service role (server-only): remove their storage objects and
 *     permanently disable the Auth user. The account is already closed;
 *     a failure here is recorded for retry and reported honestly — it is
 *     never presented as a completed deletion.
 *  3. Sign out everywhere, then leave for the public confirmation page.
 */
export async function deleteMyAccount(confirmation: string): Promise<DeleteAccountResult> {
  if (confirmation !== DELETE_CONFIRMATION) {
    return { ok: false, error: `Type ${DELETE_CONFIRMATION} to confirm.` }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Please sign in again to delete your account.' }
  }

  const { data, error } = await supabase.rpc('close_my_account')
  if (error || !data) {
    const message = error?.message ?? ''
    return { ok: false, error: STAFF_MESSAGES.includes(message) ? message : GENERIC_FAILURE }
  }

  let cleanupComplete = false
  try {
    const result = await finalizeAccountClosure(
      createServiceClient(),
      user.id,
      (data as { storage_objects?: ClosureStorageObjects }).storage_objects
    )
    cleanupComplete = result.error === null
    if (result.error) console.error('[account-deletion] cleanup incomplete', { userId: user.id, error: result.error })
  } catch (err) {
    console.error('[account-deletion] cleanup failed', { userId: user.id, message: err instanceof Error ? err.message : String(err) })
  }

  try {
    await supabase.auth.signOut({ scope: 'global' })
  } catch {
    // The account is already closed (every write refused, hidden from
    // everyone) and Auth-banned, so a leftover session cannot refresh.
  }

  redirect(cleanupComplete ? '/account-deleted' : '/account-deleted?cleanup=pending')
}
