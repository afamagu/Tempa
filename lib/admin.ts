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
}

export type MemberSearchResult = {
  id: string
  pseudonym: string
  country: string | null
}

export type MemberDetail = {
  id: string
  pseudonym: string
  country: string | null
  status: AccountStatus
  statusReason: string | null
  statusChangedAt: string | null
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

export async function listReports(
  supabase: SupabaseClient
): Promise<{ data: ReportQueueRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_reports')
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

export async function getMember(
  supabase: SupabaseClient,
  userId: string
): Promise<{ data: MemberDetail | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_get_member', { p_user_id: userId })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; pseudonym: string; country: string | null; status: AccountStatus; status_reason: string | null; status_changed_at: string | null }
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
    },
    error: null,
  }
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
