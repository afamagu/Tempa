import type { SupabaseClient } from '@supabase/supabase-js'
import type { ReportReason, ReportTargetType } from '@/lib/reports'

/**
 * Staff-only moderation surface — thin wrappers around the admin RPCs in
 * docs/sql/2026-09-17-reporting-and-admin-moderation.sql. Every RPC
 * checks is_staff() itself, server-side, inside its own SECURITY
 * DEFINER body — these wrappers are a call-shape convenience only, never
 * the authorization boundary. See app/admin/layout.tsx for the
 * server-side route gate that keeps a non-staff visitor from ever
 * reaching a page that would call these.
 */

export type AccountStatus = 'active' | 'restricted' | 'suspended' | 'banned'

export type ReportQueueRow = {
  id: string
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  status: 'open' | 'reviewed'
  createdAt: string
  reporterUserId: string
  reporterPseudonym: string
  reportedUserId: string
  reportedPseudonym: string
}

export type ReportDetail = ReportQueueRow & {
  context: string | null
  evidenceSnapshot: Record<string, unknown>
  reportedCurrentStatus: AccountStatus
  /** Admin Phase 2A-1 — the reported content's own moderation state,
   * for the two content types this phase adds it to (dispatch,
   * question_answer); null for every other target_type. Resolved
   * server-side (admin_get_report) since an already-hidden row is
   * invisible to a non-author under ordinary RLS, staff included. */
  targetModerationStatus: 'visible' | 'hidden' | null
}

export type MemberSearchResult = {
  id: string
  pseudonym: string
  country: string | null
}

export type MemberListRow = {
  id: string
  pseudonym: string
  country: string | null
  status: AccountStatus
  createdAt: string | null
  markId: string | null
}

export type MemberListOptions = {
  query?: string
  status?: AccountStatus
  country?: string
  joinedAfter?: string
  joinedBefore?: string
  limit?: number
  offset?: number
}

export type MemberDetail = {
  id: string
  pseudonym: string
  country: string | null
  status: AccountStatus
  statusReason: string | null
  statusChangedAt: string | null
  email: string | null
  region: string | null
  ageRange: string | null
  gender: string | null
  genderCustom: string | null
  languages: string[]
  intent: string[]
  createdAt: string | null
  markId: string | null
}

export type MemberReportRow = {
  id: string
  role: 'as_target' | 'as_reporter'
  targetType: ReportTargetType
  targetId: string
  reason: ReportReason
  status: 'open' | 'reviewed'
  createdAt: string
  otherUserId: string
  otherPseudonym: string
}

export type AuditLogRow = {
  id: string
  actorIdentifierSnapshot: string
  action: string
  reason: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export type AdminError = { message: string; code?: string } | null

/** Whether the current caller holds at least the given staff tier. */
export async function isStaff(
  supabase: SupabaseClient,
  minRole: 'moderator' | 'admin' = 'moderator'
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_staff', { p_min_role: minRole })
  if (error) return false
  return Boolean(data)
}

export type ReportListOptions = {
  status?: 'open' | 'reviewed'
  targetType?: ReportTargetType
  limit?: number
  offset?: number
}

/** Admin Operations Refinement checkpoint — the report queue is now
 * server-paginated with optional status/target-type filters (previously
 * a hard, unpaginated `limit 50` with nothing beyond it ever reachable).
 * Never fetches more than one page's worth of rows. */
export async function listReports(
  supabase: SupabaseClient,
  options: ReportListOptions = {}
): Promise<{ data: ReportQueueRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_reports', {
    p_status: options.status ?? null,
    p_target_type: options.targetType ?? null,
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    target_type: ReportTargetType
    target_id: string
    reason: ReportReason
    status: 'open' | 'reviewed'
    created_at: string
    reporter_user_id: string
    reporter_pseudonym: string
    reported_user_id: string
    reported_pseudonym: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      reporterUserId: r.reporter_user_id,
      reporterPseudonym: r.reporter_pseudonym,
      reportedUserId: r.reported_user_id,
      reportedPseudonym: r.reported_pseudonym,
    })),
    error: null,
  }
}

export async function getReport(
  supabase: SupabaseClient,
  reportId: string
): Promise<{ data: ReportDetail | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_report', { p_report_id: reportId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        id: string
        target_type: ReportTargetType
        target_id: string
        reason: ReportReason
        context: string | null
        status: 'open' | 'reviewed'
        evidence_snapshot: Record<string, unknown>
        created_at: string
        reporter_user_id: string
        reporter_pseudonym: string
        reported_user_id: string
        reported_pseudonym: string
        reported_current_status: AccountStatus
        target_moderation_status: 'visible' | 'hidden' | null
      }
    | undefined
  if (!row) return { data: null, error: null }
  return {
    data: {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      reason: row.reason,
      context: row.context,
      status: row.status,
      evidenceSnapshot: row.evidence_snapshot,
      createdAt: row.created_at,
      reporterUserId: row.reporter_user_id,
      reporterPseudonym: row.reporter_pseudonym,
      reportedUserId: row.reported_user_id,
      reportedPseudonym: row.reported_pseudonym,
      reportedCurrentStatus: row.reported_current_status,
      targetModerationStatus: row.target_moderation_status,
    },
    error: null,
  }
}

export async function markReportReviewed(
  supabase: SupabaseClient,
  reportId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_mark_report_reviewed', { p_report_id: reportId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function searchMembers(
  supabase: SupabaseClient,
  query: string
): Promise<{ data: MemberSearchResult[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_search_members', { p_query: query })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  return { data: (data ?? []) as MemberSearchResult[], error: null }
}

/** Admin Operations Refinement checkpoint — the default, server-paginated
 * Members directory: with no query, returns the newest members first;
 * with a query, narrows by pseudonym; status/country/join-date filters
 * combine with either. Never fetches more than one page's worth of
 * rows, and clamps limit/offset server-side regardless of what's passed
 * (see admin_list_members). Replaces searchMembers as the Members page's
 * primary data source — searchMembers is kept unchanged for anything
 * still depending on its exact minimal shape. */
export async function listMembers(
  supabase: SupabaseClient,
  options: MemberListOptions = {}
): Promise<{ data: MemberListRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_members', {
    p_query: options.query ?? null,
    p_status: options.status ?? null,
    p_country: options.country ?? null,
    p_joined_after: options.joinedAfter ?? null,
    p_joined_before: options.joinedBefore ?? null,
    p_limit: options.limit ?? 25,
    p_offset: options.offset ?? 0,
  })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as { id: string; pseudonym: string; country: string | null; status: AccountStatus; created_at: string | null; mark_id?: string | null }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      pseudonym: r.pseudonym,
      country: r.country,
      status: r.status,
      createdAt: r.created_at,
      markId: r.mark_id ?? null,
    })),
    error: null,
  }
}

export async function getMember(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: MemberDetail | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_member', { p_user_id: userId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        id: string
        pseudonym: string
        country: string | null
        status: AccountStatus
        status_reason: string | null
        status_changed_at: string | null
        email?: string | null
        region?: string | null
        age_range?: string | null
        gender?: string | null
        gender_custom?: string | null
        languages?: string[] | null
        intent?: string[] | null
        created_at?: string | null
        mark_id?: string | null
      }
    | undefined
  if (!row) return { data: null, error: null }
  return {
    data: {
      id: row.id,
      pseudonym: row.pseudonym,
      country: row.country,
      status: row.status,
      statusReason: row.status_reason,
      statusChangedAt: row.status_changed_at,
      email: row.email ?? null,
      region: row.region ?? null,
      ageRange: row.age_range ?? null,
      gender: row.gender ?? null,
      genderCustom: row.gender_custom ?? null,
      languages: row.languages ?? [],
      intent: row.intent ?? [],
      createdAt: row.created_at ?? null,
      markId: row.mark_id ?? null,
    },
    error: null,
  }
}

export async function sendAdminFirstLetter(
  supabase: SupabaseClient,
  memberId: string,
  body: string
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_send_first_letter', {
    p_member_id: memberId,
    p_body: body,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function listMemberReports(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: MemberReportRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_member_reports', { p_user_id: userId })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    role: 'as_target' | 'as_reporter'
    target_type: ReportTargetType
    target_id: string
    reason: ReportReason
    status: 'open' | 'reviewed'
    created_at: string
    other_user_id: string
    other_pseudonym: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      role: r.role,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      otherUserId: r.other_user_id,
      otherPseudonym: r.other_pseudonym,
    })),
    error: null,
  }
}

export async function listAuditForMember(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: AuditLogRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_audit_for_member', { p_user_id: userId })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    actor_identifier_snapshot: string
    action: string
    reason: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      actorIdentifierSnapshot: r.actor_identifier_snapshot,
      action: r.action,
      reason: r.reason,
      metadata: r.metadata,
      createdAt: r.created_at,
    })),
    error: null,
  }
}

export async function setAccountStatus(
  supabase: SupabaseClient,
  userId: string,
  status: AccountStatus,
  reason: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_account_status', {
    p_user_id: userId,
    p_status: status,
    p_reason: reason.trim(),
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** One row of docs/sql/2026-10-01-arrival-email-delivery.sql's
 * arrival_email_queue, as returned by admin_get_arrival_email_status —
 * ids, status/error text, and timestamps only, never letter content. */
export type ArrivalEmailQueueRow = {
  id: string
  letterId: string
  recipientId: string
  status: 'pending' | 'processing' | 'sent' | 'skipped' | 'failed'
  attempts: number
  maxAttempts: number
  lastError: string | null
  skippedReason: string | null
  /** Resend's own email id on a successful send — lets staff correlate
   * this row with provider-side delivery logs, without storing any
   * letter content. */
  providerMessageId: string | null
  createdAt: string
  sentAt: string | null
  updatedAt: string
}

export type ArrivalEmailStatus = {
  sendingEnabled: boolean
  counts: Partial<Record<ArrivalEmailQueueRow['status'], number>>
  recent: ArrivalEmailQueueRow[]
}

export async function getArrivalEmailStatus(
  supabase: SupabaseClient
): Promise<{ data: ArrivalEmailStatus | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_arrival_email_status')
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const result = data as {
    sendingEnabled: boolean
    counts: Partial<Record<ArrivalEmailQueueRow['status'], number>>
    recent: {
      id: string
      letter_id: string
      recipient_id: string
      status: ArrivalEmailQueueRow['status']
      attempts: number
      max_attempts: number
      last_error: string | null
      skipped_reason: string | null
      provider_message_id: string | null
      created_at: string
      sent_at: string | null
      updated_at: string
    }[]
  }
  return {
    data: {
      sendingEnabled: result.sendingEnabled,
      counts: result.counts,
      recent: result.recent.map((r) => ({
        id: r.id,
        letterId: r.letter_id,
        recipientId: r.recipient_id,
        status: r.status,
        attempts: r.attempts,
        maxAttempts: r.max_attempts,
        lastError: r.last_error,
        skippedReason: r.skipped_reason,
        providerMessageId: r.provider_message_id,
        createdAt: r.created_at,
        sentAt: r.sent_at,
        updatedAt: r.updated_at,
      })),
    },
    error: null,
  }
}

export async function setArrivalEmailSendingEnabled(
  supabase: SupabaseClient,
  enabled: boolean
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('set_arrival_email_sending_enabled', { p_enabled: enabled })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
