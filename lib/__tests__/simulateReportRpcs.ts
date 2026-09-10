// A validation-order simulation of the reporting/admin RPCs in
// docs/sql/2026-09-17-reporting-and-admin-moderation.sql — same
// convention as simulateLetterRpcs.ts/simulateCorrespondenceRpcs.ts:
// this proves the client-facing call shape and the documented
// validation ORDER, not live Postgres/RLS behavior itself (that
// migration is prepared but not executed). The SQL migration text is
// the actual authority for exact wording/behavior.

export type FakeProfile = { id: string; pseudonym: string }
export type FakeLetter = { id: string; sender_id: string; recipient_id: string; body: string; created_at?: string }
export type FakeDispatch = {
  id: string
  author_id: string
  title: string
  body: string
  status: 'published' | 'unpublished'
  published_at?: string
}
export type FakeMoment = { id: string; letter_id: string; type: 'photo' | 'postcard'; image_path: string }
export type FakeDispatchMoment = { id: string; dispatch_id: string; image_path: string }

export type FakeReport = {
  id: string
  reporter_user_id: string
  reported_user_id: string
  target_type: 'profile' | 'letter' | 'dispatch' | 'photo_moment'
  target_id: string
  reason: string
  context: string | null
  evidence_snapshot: Record<string, unknown>
  status: 'open' | 'reviewed'
  created_at: string
}

export type FakeAuditRow = {
  id: string
  actor_id: string | null
  actor_identifier_snapshot: string
  action: string
  target_type: string
  target_id: string | null
  target_identifier_snapshot: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const VALID_REASONS = ['scam_fraud', 'harassment', 'inappropriate_content', 'impersonation', 'spam', 'other']

export function createFakeReports(options: {
  viewerId: string | null
  profiles?: FakeProfile[]
  letters?: FakeLetter[]
  dispatches?: FakeDispatch[]
  moments?: FakeMoment[]
  dispatchMoments?: FakeDispatchMoment[]
  staff?: Record<string, 'moderator' | 'admin'>
}) {
  let viewerId = options.viewerId
  const profiles = options.profiles ?? []
  const letters = options.letters ?? []
  const dispatches = options.dispatches ?? []
  const moments = options.moments ?? []
  const dispatchMoments = options.dispatchMoments ?? []
  const staff = options.staff ?? {}

  const reports: FakeReport[] = []
  const accountStatus = new Map<string, { status: string; reason: string | null; changed_by: string; changed_at: string }>()
  const auditLog: FakeAuditRow[] = []

  function pseudonymOf(id: string) {
    return profiles.find((p) => p.id === id)?.pseudonym ?? null
  }

  function isStaff(callerId: string | null, minRole: 'moderator' | 'admin' = 'moderator') {
    if (!callerId) return false
    const role = staff[callerId]
    if (!role) return false
    if (minRole === 'moderator') return true
    return role === 'admin'
  }

  async function rpc(fn: string, params?: Record<string, unknown>) {
    if (fn === 'report_content') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }

      const targetType = params?.p_target_type as string
      const targetId = params?.p_target_id as string
      const reason = params?.p_reason as string
      const context = (params?.p_context as string | null) ?? null

      if (!['profile', 'letter', 'dispatch', 'photo_moment'].includes(targetType)) {
        return { data: null, error: { message: 'Unknown report target.', code: 'P0001' } }
      }
      if (!VALID_REASONS.includes(reason)) {
        return { data: null, error: { message: 'Unknown report reason.', code: 'P0001' } }
      }
      if (context && context.length > 500) {
        return { data: null, error: { message: 'Explanation is too long.', code: 'P0001' } }
      }

      let reportedUserId: string | null = null
      let evidence: Record<string, unknown> | null = null

      if (targetType === 'profile') {
        const p = profiles.find((p) => p.id === targetId)
        if (p) {
          reportedUserId = p.id
          evidence = { pseudonym: p.pseudonym }
        }
      } else if (targetType === 'letter') {
        const l = letters.find((l) => l.id === targetId && (l.sender_id === viewerId || l.recipient_id === viewerId))
        if (l) {
          reportedUserId = l.sender_id
          evidence = { body: l.body, sender_pseudonym: pseudonymOf(l.sender_id) }
        }
      } else if (targetType === 'dispatch') {
        const d = dispatches.find((d) => d.id === targetId && d.status === 'published')
        if (d) {
          reportedUserId = d.author_id
          evidence = { title: d.title, body: d.body, author_pseudonym: pseudonymOf(d.author_id) }
        }
      } else if (targetType === 'photo_moment') {
        const m = moments.find((m) => m.id === targetId && m.type === 'photo')
        if (m) {
          const l = letters.find((l) => l.id === m.letter_id)
          if (l && (l.sender_id === viewerId || l.recipient_id === viewerId)) {
            reportedUserId = l.sender_id
            evidence = { image_path: m.image_path, source: 'letter', sender_pseudonym: pseudonymOf(l.sender_id) }
          }
        }
        if (!reportedUserId) {
          const dm = dispatchMoments.find((dm) => dm.id === targetId)
          if (dm) {
            const d = dispatches.find((d) => d.id === dm.dispatch_id && d.status === 'published')
            if (d) {
              reportedUserId = d.author_id
              evidence = { image_path: dm.image_path, source: 'dispatch', sender_pseudonym: pseudonymOf(d.author_id) }
            }
          }
        }
      }

      if (!reportedUserId || !evidence) {
        const notFoundMessage =
          targetType === 'profile'
            ? 'Member not found.'
            : targetType === 'letter'
              ? 'Letter not found.'
              : targetType === 'dispatch'
                ? 'Dispatch not found.'
                : 'Photo not found.'
        return { data: null, error: { message: notFoundMessage, code: 'P0001' } }
      }

      if (reportedUserId === viewerId) {
        return { data: null, error: { message: 'You cannot report your own content.', code: 'P0001' } }
      }

      if (reports.some((r) => r.reporter_user_id === viewerId && r.target_type === targetType && r.target_id === targetId)) {
        return { data: null, error: { message: 'You have already reported this.', code: 'P0001' } }
      }

      reports.push({
        id: `report-${reports.length + 1}`,
        reporter_user_id: viewerId,
        reported_user_id: reportedUserId,
        target_type: targetType as FakeReport['target_type'],
        target_id: targetId,
        reason,
        context,
        evidence_snapshot: evidence,
        status: 'open',
        created_at: new Date().toISOString(),
      })

      return { data: null, error: null }
    }

    if (fn === 'is_staff') {
      return { data: isStaff(viewerId, (params?.p_min_role as 'moderator' | 'admin') ?? 'moderator'), error: null }
    }

    if (fn === 'admin_set_account_status') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }

      const userId = params?.p_user_id as string
      const status = params?.p_status as string
      const reason = ((params?.p_reason as string) ?? '').trim()

      if (!['active', 'restricted', 'suspended', 'banned'].includes(status)) {
        return { data: null, error: { message: 'Unknown status.', code: 'P0001' } }
      }
      if (reason.length === 0) {
        return { data: null, error: { message: 'A reason is required.', code: 'P0001' } }
      }
      if (!profiles.some((p) => p.id === userId)) {
        return { data: null, error: { message: 'Member not found.', code: 'P0001' } }
      }

      const old = accountStatus.get(userId)
      const oldStatus = old?.status ?? 'active'
      accountStatus.set(userId, { status, reason, changed_by: viewerId, changed_at: new Date().toISOString() })

      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'set_account_status',
        target_type: 'account_status',
        target_id: userId,
        target_identifier_snapshot: pseudonymOf(userId) ?? userId,
        reason,
        metadata: { old_status: oldStatus, new_status: status },
        created_at: new Date().toISOString(),
      })

      return { data: null, error: null }
    }

    if (fn === 'admin_mark_report_reviewed') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const reportId = params?.p_report_id as string
      const report = reports.find((r) => r.id === reportId)
      if (!report) return { data: null, error: { message: 'Report not found.', code: 'P0001' } }
      report.status = 'reviewed'
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'mark_report_reviewed',
        target_type: 'report',
        target_id: reportId,
        target_identifier_snapshot: null,
        reason: null,
        metadata: null,
        created_at: new Date().toISOString(),
      })
      return { data: null, error: null }
    }

    if (fn === 'admin_list_reports') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      return {
        data: reports
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((r) => ({
            id: r.id,
            target_type: r.target_type,
            target_id: r.target_id,
            reason: r.reason,
            status: r.status,
            created_at: r.created_at,
            reporter_user_id: r.reporter_user_id,
            reporter_pseudonym: pseudonymOf(r.reporter_user_id),
            reported_user_id: r.reported_user_id,
            reported_pseudonym: pseudonymOf(r.reported_user_id),
          })),
        error: null,
      }
    }

    if (fn === 'admin_get_report') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const report = reports.find((r) => r.id === (params?.p_report_id as string))
      if (!report) return { data: [], error: null }
      return {
        data: [
          {
            id: report.id,
            target_type: report.target_type,
            target_id: report.target_id,
            reason: report.reason,
            context: report.context,
            status: report.status,
            evidence_snapshot: report.evidence_snapshot,
            created_at: report.created_at,
            reporter_user_id: report.reporter_user_id,
            reporter_pseudonym: pseudonymOf(report.reporter_user_id),
            reported_user_id: report.reported_user_id,
            reported_pseudonym: pseudonymOf(report.reported_user_id),
            reported_current_status: accountStatus.get(report.reported_user_id)?.status ?? 'active',
          },
        ],
        error: null,
      }
    }

    if (fn === 'admin_search_members') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const q = ((params?.p_query as string) ?? '').trim().toLowerCase()
      if (q.length === 0) return { data: [], error: null }
      return {
        data: profiles
          .filter((p) => p.pseudonym.toLowerCase().includes(q))
          .map((p) => ({ id: p.id, pseudonym: p.pseudonym, country: null })),
        error: null,
      }
    }

    if (fn === 'admin_get_member') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const userId = params?.p_user_id as string
      const p = profiles.find((p) => p.id === userId)
      if (!p) return { data: [], error: null }
      const s = accountStatus.get(userId)
      return {
        data: [
          {
            id: p.id,
            pseudonym: p.pseudonym,
            country: null,
            status: s?.status ?? 'active',
            status_reason: s?.reason ?? null,
            status_changed_at: s?.changed_at ?? null,
          },
        ],
        error: null,
      }
    }

    if (fn === 'admin_list_member_reports') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const userId = params?.p_user_id as string
      const rows = [
        ...reports
          .filter((r) => r.reported_user_id === userId)
          .map((r) => ({
            id: r.id,
            role: 'as_target',
            target_type: r.target_type,
            target_id: r.target_id,
            reason: r.reason,
            status: r.status,
            created_at: r.created_at,
            other_user_id: r.reporter_user_id,
            other_pseudonym: pseudonymOf(r.reporter_user_id),
          })),
        ...reports
          .filter((r) => r.reporter_user_id === userId)
          .map((r) => ({
            id: r.id,
            role: 'as_reporter',
            target_type: r.target_type,
            target_id: r.target_id,
            reason: r.reason,
            status: r.status,
            created_at: r.created_at,
            other_user_id: r.reported_user_id,
            other_pseudonym: pseudonymOf(r.reported_user_id),
          })),
      ]
      return { data: rows, error: null }
    }

    if (fn === 'admin_list_audit_for_member') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const userId = params?.p_user_id as string
      return {
        data: auditLog
          .filter((a) => a.target_type === 'account_status' && a.target_id === userId)
          .map((a) => ({
            id: a.id,
            actor_identifier_snapshot: a.actor_identifier_snapshot,
            action: a.action,
            reason: a.reason,
            metadata: a.metadata,
            created_at: a.created_at,
          })),
        error: null,
      }
    }

    throw new Error(`simulateReportRpcs: no rpc handler for "${fn}"`)
  }

  return {
    rpc,
    storage: {
      from() {
        return { async createSignedUrl() { return { data: null, error: null } } }
      },
    },
    /** Test-only escape hatches. */
    _reports: reports,
    _auditLog: auditLog,
    _accountStatus: accountStatus,
    _setViewer(id: string | null) {
      viewerId = id
    },
  }
}
