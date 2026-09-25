import type { SupabaseClient } from '@supabase/supabase-js'

// Admin → Feedback → Account exits. One staff-gated RPC
// (admin_account_exit_feedback, docs/sql/2026-10-16-account-lifecycle.sql)
// returns aggregates and recent notes with NO member identity.

export const EXIT_FEEDBACK_WINDOWS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time', days: null },
] as const

export type ExitFeedbackWindowKey = (typeof EXIT_FEEDBACK_WINDOWS)[number]['key']

export type AccountExitFeedback = {
  deactivations: number
  reactivations: number
  deletions: number
  currentlyOnBreak: number
  reasons: { event: 'deactivation' | 'deletion'; reasonCode: string; count: number }[]
  recent: { event: 'deactivation' | 'reactivation' | 'deletion'; reasonCode: string | null; detail: string | null; at: string }[]
  letterPassNotes: { detail: string; at: string }[]
}

export function resolveExitFeedbackWindow(key: string | undefined, now: Date = new Date()) {
  const window = EXIT_FEEDBACK_WINDOWS.find((w) => w.key === key) ?? EXIT_FEEDBACK_WINDOWS[1]
  const since = window.days === null ? null : new Date(now.getTime() - window.days * 86_400_000).toISOString()
  return { window, since }
}

/** Share of `count` within its own event, as a whole percentage. */
export function reasonShare(feedback: AccountExitFeedback, event: 'deactivation' | 'deletion', count: number): number {
  const total = feedback.reasons.filter((r) => r.event === event).reduce((sum, r) => sum + r.count, 0)
  return total === 0 ? 0 : Math.round((count / total) * 100)
}

type Raw = {
  deactivations: number | string
  reactivations: number | string
  deletions: number | string
  currently_on_break: number | string
  reasons: { event: 'deactivation' | 'deletion'; reason_code: string; count: number | string }[]
  recent: { event: 'deactivation' | 'reactivation' | 'deletion'; reason_code: string | null; detail: string | null; at: string }[]
  letter_pass_notes: { detail: string; at: string }[]
}

export async function getAccountExitFeedback(
  supabase: SupabaseClient,
  since: string | null
): Promise<{ data: AccountExitFeedback | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_account_exit_feedback', { p_since: since })
  if (error || !data) return { data: null, error: error?.message ?? 'No data' }
  const raw = data as Raw
  return {
    error: null,
    data: {
      deactivations: Number(raw.deactivations),
      reactivations: Number(raw.reactivations),
      deletions: Number(raw.deletions),
      currentlyOnBreak: Number(raw.currently_on_break),
      reasons: (raw.reasons ?? []).map((r) => ({ event: r.event, reasonCode: r.reason_code, count: Number(r.count) })),
      recent: (raw.recent ?? []).map((r) => ({ event: r.event, reasonCode: r.reason_code, detail: r.detail, at: r.at })),
      letterPassNotes: raw.letter_pass_notes ?? [],
    },
  }
}
