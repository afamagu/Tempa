'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { DELETE_CONFIRMATION, finalizeAccountClosure, type ClosureStorageObjects } from '@/lib/account-deletion'
import { DEACTIVATION_REASONS, DELETION_REASONS, exitFeedbackArgs, type ExitFeedback } from '@/lib/account-lifecycle'

export type LifecycleActionResult = { ok: false; error: string }

const GENERIC_FAILURE = 'We couldn’t delete your account. Nothing has been changed — please try again.'
const STAFF_MESSAGES = [
  'Staff accounts are closed by Tempa administrators.',
  'This account created official Tempa content and is closed by Tempa administrators.',
  'Staff accounts can’t take a break here. Ask another administrator.',
  'Staff accounts can\'t take a break here. Ask another administrator.',
]

/**
 * Delete (close) the SIGNED-IN member's own account. The account is
 * whoever the request's own session resolves to; close_my_account()
 * re-derives that from auth.uid(). Its only arguments are the optional
 * exit reason, stored atomically with the closure — there is no target
 * account argument anywhere.
 *
 *  1. close_my_account() under the member's session — atomic: closes the
 *     account and deletes/de-identifies their data. If this fails,
 *     nothing changed and the member is told so.
 *  2. Service role (server-only): remove their storage objects and
 *     permanently disable the Auth user. The account is already closed;
 *     a failure here is recorded for retry and reported honestly.
 *  3. Sign out everywhere, then leave for the public confirmation page.
 */
export async function deleteMyAccount(confirmation: string, feedback?: ExitFeedback | null): Promise<LifecycleActionResult> {
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

  const { data, error } = await supabase.rpc('close_my_account', exitFeedbackArgs(feedback, DELETION_REASONS))
  if (error || !data) {
    // Server-side only — the member only ever sees GENERIC_FAILURE (or a
    // fixed staff message). Without this line a failed closure left no
    // trace of the actual database error.
    console.error('[account-deletion] close_my_account failed', {
      userId: user.id,
      code: error?.code ?? null,
      message: error?.message ?? 'no data returned',
      details: error?.details ?? null,
      hint: error?.hint ?? null,
    })
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

/**
 * Take a break: a reversible pause of the signed-in member's own account
 * (deactivate_my_account — self only, optional reason). Nothing is
 * deleted; the member is sent to /account-paused, where Return to Tempa
 * explicitly reactivates.
 */
export async function deactivateMyAccount(feedback?: ExitFeedback | null): Promise<LifecycleActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Please sign in again.' }
  }

  const { error } = await supabase.rpc('deactivate_my_account', exitFeedbackArgs(feedback, DEACTIVATION_REASONS))
  if (error) {
    return {
      ok: false,
      error: error.message.startsWith('Staff accounts')
        ? 'Staff accounts can’t take a break here. Ask another administrator.'
        : 'We couldn’t pause your account. Nothing has been changed — please try again.',
    }
  }

  redirect('/account-paused')
}

/** Return to Tempa: explicitly ends the signed-in member's own break. */
export async function reactivateMyAccount(): Promise<LifecycleActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/sign-in')
  }

  const { error } = await supabase.rpc('reactivate_my_account')
  if (error) {
    return { ok: false, error: 'We couldn’t reopen your account just now. Please try again.' }
  }

  redirect('/home')
}
