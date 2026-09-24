import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError, AccountStatus } from './admin'
import type { RiskBand } from './safety'

/**
 * Safety 2, Checkpoints 7-8 — thin wrappers around the staff-only Needs
 * Attention RPCs (docs/sql/2026-10-08-safety-checkpoint7-admin-needs-
 * attention.sql, docs/sql/2026-10-09-safety-checkpoint8-graduated-
 * interventions.sql — prepared but not yet applied). Every RPC checks
 * is_staff() itself, server-side — same convention as lib/admin.ts/
 * lib/admin-moderation.ts; these wrappers are a call-shape convenience
 * only, never the authorization boundary.
 */

// Checkpoint 8 — 'warned'/'restricted'/'suspended'/'banned' are all
// real, historical TERMINAL outcomes safety_cases' own CHECK constraint
// has always allowed (Checkpoint 2's original domain) — only 'open' and
// 'reviewing' are ever "active" for the one-active-case invariant.
// 'warned' remains structurally valid but is not reachable through any
// RPC yet (see the Checkpoint 8 migration's own header for why).
export type CaseStatus = 'open' | 'reviewing' | 'no_action' | 'resolved' | 'warned' | 'restricted' | 'suspended' | 'banned'
export type CaseStatusFilter = CaseStatus | 'active' | 'all'
/** The three graduated account interventions this checkpoint actually
 * makes reachable — never 'warned' (deferred), never a review-only
 * outcome (Checkpoint 7's own admin_transition_safety_case owns those). */
export type CaseInterventionStatus = 'restricted' | 'suspended' | 'banned'

export type SafetyCaseRow = {
  id: string
  subjectUserId: string
  subjectPseudonym: string
  status: CaseStatus
  highestRiskBand: RiskBand
  signalCount: number
  openedAt: string
  updatedAt: string
  /** A distinct, aggregated array of every reason code across this
   * case's own linked signals — a compact structured summary, never a
   * numeric "fraud score." */
  reasonCodes: string[]
}

// 'all' means "explicitly no filter" (maps to the RPC's own p_status =
// null); undefined means "the caller didn't specify one," which
// defaults to the RPC's own 'active' default. These are deliberately
// NOT the same thing — a plain `?? 'active'` on the mapped value would
// wrongly turn an explicit 'all' back into 'active'.
function mapStatusFilter(status: CaseStatusFilter | undefined): string {
  if (status === undefined) return 'active'
  if (status === 'all') return 'all'
  return status
}

export async function listSafetyCases(
  supabase: SupabaseClient,
  options: { status?: CaseStatusFilter; limit?: number; offset?: number } = {}
): Promise<{ data: SafetyCaseRow[]; error: AdminError }> {
  const mappedStatus = mapStatusFilter(options.status)
  const { data, error } = await supabase.rpc('admin_list_safety_cases', {
    p_status: mappedStatus === 'all' ? null : mappedStatus,
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    subject_user_id: string
    subject_pseudonym: string
    status: CaseStatus
    highest_risk_band: RiskBand
    signal_count: number
    opened_at: string
    updated_at: string
    reason_codes: string[]
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      subjectUserId: r.subject_user_id,
      subjectPseudonym: r.subject_pseudonym,
      status: r.status,
      highestRiskBand: r.highest_risk_band,
      signalCount: r.signal_count,
      openedAt: r.opened_at,
      updatedAt: r.updated_at,
      reasonCodes: r.reason_codes ?? [],
    })),
    error: null,
  }
}

export type SafetyCaseDetail = {
  id: string
  subjectUserId: string
  subjectPseudonym: string
  subjectAccountStatus: AccountStatus
  /** auth.users.created_at — the same canonical account-age source the
   * behavioral engine itself uses (Checkpoint 5); never public.profiles'
   * own unconfirmable created_at. Context for the reviewer, never
   * treated as guilt on its own (see the workspace UI's own copy). */
  subjectAccountCreatedAt: string | null
  subjectReportCount: number
  subjectBlockCount: number
  status: CaseStatus
  highestRiskBand: RiskBand
  signalCount: number
  openedAt: string
  updatedAt: string
  reviewedAt: string | null
  reviewedByPseudonym: string | null
}

export async function getSafetyCase(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ data: SafetyCaseDetail | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_safety_case', { p_case_id: caseId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        id: string
        subject_user_id: string
        subject_pseudonym: string
        subject_account_status: AccountStatus
        subject_account_created_at: string | null
        subject_report_count: number
        subject_block_count: number
        status: CaseStatus
        highest_risk_band: RiskBand
        signal_count: number
        opened_at: string
        updated_at: string
        reviewed_at: string | null
        reviewed_by_pseudonym: string | null
      }
    | undefined
  if (!row) return { data: null, error: null }
  return {
    data: {
      id: row.id,
      subjectUserId: row.subject_user_id,
      subjectPseudonym: row.subject_pseudonym,
      subjectAccountStatus: row.subject_account_status,
      subjectAccountCreatedAt: row.subject_account_created_at,
      subjectReportCount: row.subject_report_count,
      subjectBlockCount: row.subject_block_count,
      status: row.status,
      highestRiskBand: row.highest_risk_band,
      signalCount: row.signal_count,
      openedAt: row.opened_at,
      updatedAt: row.updated_at,
      reviewedAt: row.reviewed_at,
      reviewedByPseudonym: row.reviewed_by_pseudonym,
    },
    error: null,
  }
}

export type SafetySignalRow = {
  id: string
  surface: string
  contextId: string
  reasonCodes: string[]
  riskBand: RiskBand
  createdAt: string
  warningRequired: boolean
  warningIssuedAt: string | null
  warningAcknowledgedAt: string | null
  mutationDisposition: 'allow' | 'warn' | 'deny' | null
  proceededAt: string | null
  sourceContentId: string | null
  /** Checkpoint 5's own structured behavioral counts (e.g. "8 distinct
   * recipients in 1 hour") — null for every content signal. Rendered
   * as-is; never a raw activity log. */
  observedCounts: Record<string, unknown> | null
}

export async function listCaseSignals(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ data: SafetySignalRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_case_signals', { p_case_id: caseId })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    surface: string
    context_id: string
    reason_codes: string[]
    risk_band: RiskBand
    created_at: string
    warning_required: boolean | null
    warning_issued_at: string | null
    warning_acknowledged_at: string | null
    mutation_disposition: 'allow' | 'warn' | 'deny' | null
    proceeded_at: string | null
    source_content_id: string | null
    observed_counts: Record<string, unknown> | null
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      surface: r.surface,
      contextId: r.context_id,
      reasonCodes: r.reason_codes ?? [],
      riskBand: r.risk_band,
      createdAt: r.created_at,
      warningRequired: Boolean(r.warning_required),
      warningIssuedAt: r.warning_issued_at,
      warningAcknowledgedAt: r.warning_acknowledged_at,
      mutationDisposition: r.mutation_disposition,
      proceededAt: r.proceeded_at,
      sourceContentId: r.source_content_id,
      observedCounts: r.observed_counts,
    })),
    error: null,
  }
}

/** The narrowest possible private-content evidence result — see the
 * migration's own header for why this can only ever be reached via a
 * real safety_signals id, never a raw Letter/content id. `'letter'` is
 * the only kind that ever carries actual text; every public kind only
 * ever carries enough identity to link out to the existing public page. */
export type SafetyEvidence =
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'letter'; body: string; senderPseudonym: string; recipientPseudonym: string; createdAt: string }
  | { kind: 'public'; contentType: 'dispatch' | 'dispatch_reply' | 'question_answer'; contentId: string; dispatchId: string | null }

/**
 * Independent audit correction: requires the case this signal is
 * believed to belong to, not merely the signal id — a signal can
 * legitimately exist with no case (never escalated) or with a
 * DIFFERENT case's id, and admin_get_safety_signal_evidence now only
 * ever resolves a signal whose own case_id matches p_case_id, verified
 * server-side. Still no raw Letter/content/correspondence id parameter
 * anywhere — caseId is the case-detail page's own already-loaded case.
 */
export async function getSafetyEvidence(
  supabase: SupabaseClient,
  caseId: string,
  signalId: string
): Promise<{ data: SafetyEvidence | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_safety_signal_evidence', {
    p_case_id: caseId,
    p_signal_id: signalId,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        evidence_kind: 'none' | 'unavailable' | 'letter' | 'public'
        letter_body: string | null
        letter_sender_pseudonym: string | null
        letter_recipient_pseudonym: string | null
        letter_created_at: string | null
        public_content_type: 'dispatch' | 'dispatch_reply' | 'question_answer' | null
        public_content_id: string | null
        public_dispatch_id: string | null
      }
    | undefined
  if (!row) return { data: null, error: null }

  if (row.evidence_kind === 'letter') {
    return {
      data: {
        kind: 'letter',
        body: row.letter_body ?? '',
        senderPseudonym: row.letter_sender_pseudonym ?? '',
        recipientPseudonym: row.letter_recipient_pseudonym ?? '',
        createdAt: row.letter_created_at ?? '',
      },
      error: null,
    }
  }
  if (row.evidence_kind === 'public' && row.public_content_type && row.public_content_id) {
    return {
      data: {
        kind: 'public',
        contentType: row.public_content_type,
        contentId: row.public_content_id,
        dispatchId: row.public_dispatch_id,
      },
      error: null,
    }
  }
  if (row.evidence_kind === 'unavailable') return { data: { kind: 'unavailable' }, error: null }
  return { data: { kind: 'none' }, error: null }
}

/** The three review-only transitions Checkpoint 7 owns — never
 * restriction/suspension/ban (Checkpoint 8's own applySafetyCaseIntervention
 * below) or warning (deferred). */
export type CaseTransitionTarget = 'reviewing' | 'no_action' | 'resolved'

export async function transitionSafetyCase(
  supabase: SupabaseClient,
  caseId: string,
  expectedStatus: CaseStatus,
  newStatus: CaseTransitionTarget,
  reason?: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_transition_safety_case', {
    p_case_id: caseId,
    p_expected_status: expectedStatus,
    p_new_status: newStatus,
    p_reason: reason?.trim() || null,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/**
 * Safety 2, Checkpoint 8 — the one case-aware, transactional graduated-
 * intervention path. Requires BOTH the case's own expected status and
 * the member's own expected account status (item 6 — optimistic
 * concurrency on both axes independently, since the account status can
 * also change via the entirely separate ordinary member-workspace path,
 * app/admin/account-status-actions.tsx, which never touches the case at
 * all). A reason is always required — admin_apply_safety_case_
 * intervention rejects a blank one itself, the same way admin_set_
 * account_status already does.
 */
export async function applySafetyCaseIntervention(
  supabase: SupabaseClient,
  params: {
    caseId: string
    expectedCaseStatus: CaseStatus
    expectedAccountStatus: AccountStatus
    newStatus: CaseInterventionStatus
    reason: string
  }
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_apply_safety_case_intervention', {
    p_case_id: params.caseId,
    p_expected_case_status: params.expectedCaseStatus,
    p_expected_account_status: params.expectedAccountStatus,
    p_new_status: params.newStatus,
    p_reason: params.reason.trim(),
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

// ---------------------------------------------------------------------
// Phase 1 — the attempt evidence behind a case
// (docs/sql/2026-10-12-safety-phase1-enforcement.sql —
// admin_get_safety_case_review; staff-gated and audited server-side).
// ---------------------------------------------------------------------

export type CaseReviewSummary = {
  subjectPseudonym: string
  accountCreatedAt: string | null
  accountAgeDays: number | null
  accountStatus: AccountStatus
  /** status = 'restricted' set by the system (not a person) — awaiting a human decision. */
  restrictionPendingReview: boolean
  statusChangedAt: string | null
  qualifyingAttempts72h: number
  distinctContexts72h: number
  qualifyingAttemptsTotal: number
  firstQualifyingAttemptAt: string | null
  lastQualifyingAttemptAt: string | null
  firstContacts24h: number
  distinctFirstContactRecipients24h: number
  contactSharingEvaluations30d: number
  /** reason code -> number of signals in the last 30 days. */
  behavioralSignals30d: Record<string, number>
}

export type CaseReviewAttempt = {
  evaluationId: string
  createdAt: string
  surface: string
  /** An anonymous label ("Person A") — never an id or a name. */
  recipientOrdinal: string
  reasonCodes: string[]
  riskBand: RiskBand
  mutationDisposition: 'allow' | 'warn' | 'deny'
  qualifying: boolean
  /** false for a denied attempt that was never sent. */
  sent: boolean
  attemptedTitle: string | null
  attemptedTopics: string[] | null
  attemptedBody: string | null
}

export type CaseReview = { summary: CaseReviewSummary; attempts: CaseReviewAttempt[] }

export async function getSafetyCaseReview(
  supabase: SupabaseClient,
  caseId: string
): Promise<{ data: CaseReview | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_safety_case_review', { p_case_id: caseId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const raw = data as
    | {
        summary: Record<string, unknown>
        attempts: Array<Record<string, unknown>>
      }
    | null
  if (!raw) return { data: null, error: null }
  const s = raw.summary
  return {
    data: {
      summary: {
        subjectPseudonym: String(s.subject_pseudonym ?? ''),
        accountCreatedAt: (s.account_created_at as string | null) ?? null,
        accountAgeDays: s.account_age_days === null || s.account_age_days === undefined ? null : Number(s.account_age_days),
        accountStatus: s.account_status as AccountStatus,
        restrictionPendingReview: Boolean(s.restriction_pending_review),
        statusChangedAt: (s.status_changed_at as string | null) ?? null,
        qualifyingAttempts72h: Number(s.qualifying_attempts_72h ?? 0),
        distinctContexts72h: Number(s.distinct_contexts_72h ?? 0),
        qualifyingAttemptsTotal: Number(s.qualifying_attempts_total ?? 0),
        firstQualifyingAttemptAt: (s.first_qualifying_attempt_at as string | null) ?? null,
        lastQualifyingAttemptAt: (s.last_qualifying_attempt_at as string | null) ?? null,
        firstContacts24h: Number(s.first_contacts_24h ?? 0),
        distinctFirstContactRecipients24h: Number(s.distinct_first_contact_recipients_24h ?? 0),
        contactSharingEvaluations30d: Number(s.contact_sharing_evaluations_30d ?? 0),
        behavioralSignals30d: (s.behavioral_signals_30d as Record<string, number> | undefined) ?? {},
      },
      attempts: (raw.attempts ?? []).map((a) => ({
        evaluationId: String(a.evaluation_id),
        createdAt: String(a.created_at),
        surface: String(a.surface),
        recipientOrdinal: String(a.recipient_ordinal),
        reasonCodes: (a.reason_codes as string[] | undefined) ?? [],
        riskBand: a.risk_band as RiskBand,
        mutationDisposition: a.mutation_disposition as 'allow' | 'warn' | 'deny',
        qualifying: Boolean(a.qualifying),
        sent: Boolean(a.sent),
        attemptedTitle: (a.attempted_title as string | null) ?? null,
        attemptedTopics: (a.attempted_topics as string[] | null) ?? null,
        attemptedBody: (a.attempted_body as string | null) ?? null,
      })),
    },
    error: null,
  }
}
