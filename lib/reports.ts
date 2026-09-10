import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Member reporting — pre-beta minimum safety build. A thin client
 * wrapper around report_content (docs/sql/2026-09-17-reporting-and-
 * admin-moderation.sql) — that RPC is the actual authorization/
 * validation boundary (it derives reported_user_id and the evidence
 * snapshot entirely server-side, rejects self-reports and duplicates);
 * this module exists only for a consistent client call shape shared by
 * every report surface (letter, Dispatch, photo Moment, profile).
 *
 * Reporting is deliberately independent of blocking (lib/blocking.ts) —
 * neither reads nor writes the other's state, and this module never
 * exposes a way to check "did I already report this" beyond the RPC's
 * own duplicate-rejection error, matching the product rule that a
 * report's existence/outcome is never surfaced back to the reporter
 * beyond a quiet confirmation.
 */

// 'question_answer' added Admin Phase 2A-1 — reportable only when the
// caller could legitimately see it (active Question, moderation_status
// = 'visible', not a blocked pair — the same predicate as its own read
// policy), enforced entirely server-side by report_content.
export type ReportTargetType = 'profile' | 'letter' | 'dispatch' | 'photo_moment' | 'question_answer'

export type ReportReason =
  | 'scam_fraud'
  | 'harassment'
  | 'inappropriate_content'
  | 'impersonation'
  | 'spam'
  | 'other'

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: 'scam_fraud', label: 'Scam, fraud or money request' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'inappropriate_content', label: 'Inappropriate content' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
]

export const REPORT_CONTEXT_MAX_LENGTH = 500

export type ReportError = { message: string; code?: string } | null

export async function reportContent(
  supabase: SupabaseClient,
  targetType: ReportTargetType,
  targetId: string,
  reason: ReportReason,
  context: string
): Promise<{ error: ReportError }> {
  const trimmedContext = context.trim()
  const { error } = await supabase.rpc('report_content', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_context: trimmedContext.length > 0 ? trimmedContext : null,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
