import { createClient } from '@/lib/supabase/server'
import { getAccountExitFeedback, resolveExitFeedbackWindow } from '@/lib/account-exit-feedback'
import AccountExitFeedbackView from './account-exit-feedback-view'

/**
 * Admin → Feedback → Account exits. Staff-gated twice: by the admin
 * layout and inside admin_account_exit_feedback itself. Aggregates and
 * notes only — no member identity, email or date of birth is ever
 * returned or shown.
 */
export default async function AccountExitFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const { window: windowKey } = await searchParams
  const { window, since } = resolveExitFeedbackWindow(windowKey)
  const supabase = await createClient()
  const { data, error } = await getAccountExitFeedback(supabase, since)

  return <AccountExitFeedbackView windowKey={window.key} data={error ? null : data} />
}
