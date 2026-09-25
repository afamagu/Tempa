// Account lifecycle — shared reason sets (client-safe). Stable CODES are
// what the database stores and validates (docs/sql/2026-10-16-account-
// lifecycle.sql); LABELS are display copy and may change freely.
// Giving a reason is always optional.

export type ExitReason = { code: string; label: string }

export const SOMETHING_ELSE = 'something_else'
export const EXIT_REASON_DETAIL_MAX = 1000

export const DEACTIVATION_REASONS: ExitReason[] = [
  { code: 'need_a_break', label: 'I need a break' },
  { code: 'life_is_busy', label: 'Life is busy right now' },
  { code: 'not_finding_connections', label: 'I’m not finding the connections I hoped for' },
  { code: 'too_many_letters', label: 'Too many letters or notifications' },
  { code: 'privacy_or_safety', label: 'A privacy or safety concern' },
  { code: SOMETHING_ELSE, label: 'Something else' },
]

export const DELETION_REASONS: ExitReason[] = [
  { code: 'not_finding_connections', label: 'I’m not finding the connections I hoped for' },
  { code: 'not_using_tempa', label: 'I don’t use Tempa anymore' },
  { code: 'not_meeting_expectations', label: 'Tempa isn’t what I expected' },
  { code: 'too_many_letters', label: 'Too many letters or notifications' },
  { code: 'privacy_or_safety', label: 'A privacy or safety concern' },
  { code: SOMETHING_ELSE, label: 'Something else' },
]

export type ExitFeedback = { reasonCode: string | null; reasonDetail: string }

/** RPC arguments: detail only ever travels with "Something else". */
export function exitFeedbackArgs(feedback: ExitFeedback | null | undefined, allowed: ExitReason[]) {
  const code = feedback?.reasonCode && allowed.some((r) => r.code === feedback.reasonCode) ? feedback.reasonCode : null
  const detail = code === SOMETHING_ELSE ? feedback?.reasonDetail.trim().slice(0, EXIT_REASON_DETAIL_MAX) || null : null
  return { p_reason_code: code, p_reason_detail: detail }
}

export function reasonLabel(code: string | null | undefined): string {
  if (!code || code === 'not_given') return 'No reason given'
  return [...DEACTIVATION_REASONS, ...DELETION_REASONS].find((r) => r.code === code)?.label ?? code
}
