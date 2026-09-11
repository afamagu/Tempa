// A validation-order simulation of the reporting/admin RPCs in
// docs/sql/2026-09-17-reporting-and-admin-moderation.sql — same
// convention as simulateLetterRpcs.ts/simulateCorrespondenceRpcs.ts:
// this proves the client-facing call shape and the documented
// validation ORDER, not live Postgres/RLS behavior itself (that
// migration is prepared but not executed). The SQL migration text is
// the actual authority for exact wording/behavior.

export type FakeProfile = { id: string; pseudonym: string; country?: string | null; created_at?: string }
export type FakeLetter = { id: string; sender_id: string; recipient_id: string; body: string; created_at?: string }
export type FakeDispatch = {
  id: string
  author_id: string
  title: string
  body: string
  status: 'published' | 'unpublished'
  published_at?: string
  // Admin Phase 2A-1 — defaults to 'visible' when omitted.
  moderation_status?: 'visible' | 'hidden'
  moderated_at?: string | null
}
export type FakeMoment = { id: string; letter_id: string; type: 'photo' | 'postcard'; image_path: string }
export type FakeDispatchMoment = { id: string; dispatch_id: string; image_path: string }

// Admin Phase 2A-1 — canonical Questions + their answers, for
// question_answer reportability/hide-restore/Questions-admin.
export type FakeQuestion = {
  id: string
  slug: string | null
  prompt: string
  is_active: boolean
  family?: string | null
  created_at?: string
}
export type FakeQuestionAnswer = {
  id: string
  question_id: string
  user_id: string
  body: string
  moderation_status?: 'visible' | 'hidden'
  moderated_at?: string | null
  updated_at?: string
  // Final pre-apply correction — defaults to false when omitted.
  is_current?: boolean
}

export type FakeReport = {
  id: string
  reporter_user_id: string
  reported_user_id: string
  target_type: 'profile' | 'letter' | 'dispatch' | 'photo_moment' | 'question_answer'
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
  questions?: FakeQuestion[]
  questionAnswers?: FakeQuestionAnswer[]
  staff?: Record<string, 'moderator' | 'admin'>
}) {
  let viewerId = options.viewerId
  const profiles = options.profiles ?? []
  const letters = options.letters ?? []
  const dispatches = options.dispatches ?? []
  const moments = options.moments ?? []
  const dispatchMoments = options.dispatchMoments ?? []
  const questions = options.questions ?? []
  const questionAnswers = options.questionAnswers ?? []
  const staff = options.staff ?? {}

  // Default every dispatch/answer to 'visible' unless the fixture says
  // otherwise — mirrors the migration's `not null default 'visible'`.
  for (const d of dispatches) if (d.moderation_status === undefined) d.moderation_status = 'visible'
  for (const qa of questionAnswers) if (qa.moderation_status === undefined) qa.moderation_status = 'visible'
  for (const qa of questionAnswers) if (qa.is_current === undefined) qa.is_current = false
  for (const q of questions) if (q.family === undefined) q.family = null
  for (const q of questions) if (q.created_at === undefined) q.created_at = new Date().toISOString()

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

      if (!['profile', 'letter', 'dispatch', 'photo_moment', 'question_answer'].includes(targetType)) {
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
          evidence = {
            body: l.body,
            sender_pseudonym: pseudonymOf(l.sender_id),
            letter_created_at: l.created_at ?? new Date().toISOString(),
          }
        }
      } else if (targetType === 'dispatch') {
        const d = dispatches.find(
          (d) => d.id === targetId && d.status === 'published' && d.moderation_status === 'visible'
        )
        if (d) {
          reportedUserId = d.author_id
          evidence = { title: d.title, body: d.body, author_pseudonym: pseudonymOf(d.author_id) }
        }
      } else if (targetType === 'question_answer') {
        const qa = questionAnswers.find((qa) => qa.id === targetId && qa.moderation_status === 'visible')
        const q = qa ? questions.find((q) => q.id === qa.question_id && q.is_active) : undefined
        if (qa && q) {
          reportedUserId = qa.user_id
          evidence = { prompt: q.prompt, body: qa.body, author_pseudonym: pseudonymOf(qa.user_id) }
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
            // Independent review item 3: same visibility predicate as
            // the plain 'dispatch' branch — a hidden parent Dispatch's
            // Moment is not reportable by a guessed/stale id either.
            const d = dispatches.find(
              (d) => d.id === dm.dispatch_id && d.status === 'published' && d.moderation_status === 'visible'
            )
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
                : targetType === 'question_answer'
                  ? 'Answer not found.'
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
      const status = (params?.p_status as string | null) ?? null
      const targetType = (params?.p_target_type as string | null) ?? null
      if (status !== null && !['open', 'reviewed'].includes(status)) {
        return { data: null, error: { message: 'Invalid status filter.', code: 'P0001' } }
      }
      if (
        targetType !== null &&
        !['profile', 'letter', 'dispatch', 'photo_moment', 'question_answer'].includes(targetType)
      ) {
        return { data: null, error: { message: 'Invalid target type filter.', code: 'P0001' } }
      }
      const limit = Math.min(Math.max((params?.p_limit as number) ?? 30, 1), 50)
      const offset = Math.max((params?.p_offset as number) ?? 0, 0)
      const filtered = reports
        .filter((r) => status === null || r.status === status)
        .filter((r) => targetType === null || r.target_type === targetType)
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
        }))
      return { data: filtered.slice(offset, offset + limit), error: null }
    }

    if (fn === 'admin_list_members') {
      if (!isStaff(viewerId)) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const status = (params?.p_status as string | null) ?? null
      if (status !== null && !['active', 'restricted', 'suspended', 'banned'].includes(status)) {
        return { data: null, error: { message: 'Invalid account status filter.', code: 'P0001' } }
      }
      const query = ((params?.p_query as string | null) ?? '').trim().toLowerCase()
      const country = (params?.p_country as string | null) ?? null
      const joinedAfter = (params?.p_joined_after as string | null) ?? null
      const joinedBefore = (params?.p_joined_before as string | null) ?? null
      const limit = Math.min(Math.max((params?.p_limit as number) ?? 25, 1), 100)
      const offset = Math.max((params?.p_offset as number) ?? 0, 0)

      const filtered = profiles
        .filter((p) => query.length === 0 || p.pseudonym.toLowerCase().includes(query))
        .filter((p) => {
          const s = accountStatus.get(p.id)?.status ?? 'active'
          return status === null || s === status
        })
        .filter((p) => country === null || p.country === country)
        .filter((p) => joinedAfter === null || (p.created_at ?? '') >= joinedAfter)
        .filter((p) => joinedBefore === null || (p.created_at ?? '') <= joinedBefore)
        .slice()
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .map((p) => ({
          id: p.id,
          pseudonym: p.pseudonym,
          country: p.country ?? null,
          status: accountStatus.get(p.id)?.status ?? 'active',
          created_at: p.created_at ?? null,
        }))
      return { data: filtered.slice(offset, offset + limit), error: null }
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
            target_moderation_status:
              report.target_type === 'dispatch'
                ? (dispatches.find((d) => d.id === report.target_id)?.moderation_status ?? null)
                : report.target_type === 'question_answer'
                  ? (questionAnswers.find((qa) => qa.id === report.target_id)?.moderation_status ?? null)
                  : null,
          },
        ],
        error: null,
      }
    }

    // ---- Admin Phase 2A-1: hide/restore, Public Content Review, ----
    // ---- Questions admin, content audit. Moderator floor for       ----
    // ---- hide/restore + audit read; ADMIN floor for the proactive   ----
    // ---- public-content list and all Questions-management RPCs.    ----

    if (fn === 'admin_hide_dispatch' || fn === 'admin_restore_dispatch') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'moderator')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const dispatchId = params?.p_dispatch_id as string
      // Independent review item 1: admin may act on any eligible
      // target; a moderator-only caller must have a qualifying report
      // for this EXACT target — same generic message either way, never
      // leaking report existence.
      if (!isStaff(viewerId, 'admin')) {
        if (!reports.some((r) => r.target_type === 'dispatch' && r.target_id === dispatchId)) {
          return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
        }
      }
      const reason = ((params?.p_reason as string) ?? '').trim()
      if (reason.length === 0) return { data: null, error: { message: 'A reason is required.', code: 'P0001' } }
      const d = dispatches.find((d) => d.id === dispatchId)
      if (!d) return { data: null, error: { message: 'Dispatch not found.', code: 'P0001' } }
      const oldStatus = d.moderation_status
      const newStatus = fn === 'admin_hide_dispatch' ? 'hidden' : 'visible'
      // Independent review item 9: idempotency guard.
      if (oldStatus === newStatus) {
        return {
          data: null,
          error: {
            message: newStatus === 'hidden' ? 'This content is already hidden.' : 'This content is already visible.',
            code: 'P0001',
          },
        }
      }
      d.moderation_status = newStatus
      d.moderated_at = new Date().toISOString()
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: fn === 'admin_hide_dispatch' ? 'content_hidden' : 'content_restored',
        target_type: 'dispatch',
        target_id: d.id,
        target_identifier_snapshot: d.title,
        reason,
        metadata: { previous_status: oldStatus, new_status: newStatus },
        created_at: new Date().toISOString(),
      })
      return { data: null, error: null }
    }

    if (fn === 'admin_hide_question_answer' || fn === 'admin_restore_question_answer') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'moderator')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const answerId = params?.p_answer_id as string
      // Independent review item 1: same report-driven boundary as
      // admin_hide_dispatch/admin_restore_dispatch above.
      if (!isStaff(viewerId, 'admin')) {
        if (!reports.some((r) => r.target_type === 'question_answer' && r.target_id === answerId)) {
          return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
        }
      }
      const reason = ((params?.p_reason as string) ?? '').trim()
      if (reason.length === 0) return { data: null, error: { message: 'A reason is required.', code: 'P0001' } }
      const qa = questionAnswers.find((qa) => qa.id === answerId)
      if (!qa) return { data: null, error: { message: 'Answer not found.', code: 'P0001' } }
      const oldStatus = qa.moderation_status
      const newStatus = fn === 'admin_hide_question_answer' ? 'hidden' : 'visible'
      // Independent review item 9: idempotency guard.
      if (oldStatus === newStatus) {
        return {
          data: null,
          error: {
            message: newStatus === 'hidden' ? 'This content is already hidden.' : 'This content is already visible.',
            code: 'P0001',
          },
        }
      }
      const wasCurrent = qa.is_current ?? false
      qa.moderation_status = newStatus
      qa.moderated_at = new Date().toISOString()
      // Final pre-apply correction item 2: hiding also clears
      // is_current — never touched by restore (item 3), per the
      // migration's own documented decision.
      if (fn === 'admin_hide_question_answer') {
        qa.is_current = false
      }
      const q = questions.find((q) => q.id === qa.question_id)
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: fn === 'admin_hide_question_answer' ? 'content_hidden' : 'content_restored',
        target_type: 'question_answer',
        target_id: qa.id,
        target_identifier_snapshot: q?.prompt ?? null,
        reason,
        metadata:
          fn === 'admin_hide_question_answer'
            ? { previous_status: oldStatus, new_status: newStatus, was_current: wasCurrent }
            : { previous_status: oldStatus, new_status: newStatus },
        created_at: new Date().toISOString(),
      })
      return { data: null, error: null }
    }

    if (fn === 'admin_list_public_content') {
      // Admin floor only — a moderator must be refused here even though
      // they pass the plain is_staff() check, per the locked permission
      // split (proactive surveillance vs. report-driven access).
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const type = (params?.p_type as string | null) ?? null
      const status = (params?.p_status as string | null) ?? null
      const limit = Math.min(Math.max((params?.p_limit as number) ?? 30, 1), 100)
      const offset = Math.max((params?.p_offset as number) ?? 0, 0)

      const dispatchRows = dispatches
        .filter((d) => d.status === 'published')
        .filter(() => type === null || type === 'dispatch')
        .filter((d) => status === null || d.moderation_status === status)
        .map((d) => ({
          content_type: 'dispatch' as const,
          id: d.id,
          title: d.title,
          excerpt: d.body.slice(0, 280),
          author_id: d.author_id,
          author_pseudonym: pseudonymOf(d.author_id),
          moderation_status: d.moderation_status,
          moderated_at: d.moderated_at ?? null,
          content_created_at: d.published_at ?? '',
        }))

      const answerRows = questionAnswers
        .filter(() => type === null || type === 'question_answer')
        .filter((qa) => status === null || qa.moderation_status === status)
        // Independent review item 7 (revised, final audit round): a
        // VISIBLE answer counts as "Public Content" only when its
        // Question is currently active; a HIDDEN answer remains
        // reachable here regardless — it's a moderation record Admin
        // may still need to inspect/restore even after the Question is
        // later deactivated.
        .filter((qa) => {
          const isActive = questions.find((q) => q.id === qa.question_id)?.is_active === true
          return (qa.moderation_status === 'visible' && isActive) || qa.moderation_status === 'hidden'
        })
        .map((qa) => ({
          content_type: 'question_answer' as const,
          id: qa.id,
          title: questions.find((q) => q.id === qa.question_id)?.prompt ?? '',
          excerpt: qa.body.slice(0, 280),
          author_id: qa.user_id,
          author_pseudonym: pseudonymOf(qa.user_id),
          moderation_status: qa.moderation_status,
          moderated_at: qa.moderated_at ?? null,
          content_created_at: qa.updated_at ?? '',
        }))

      const combined = [...dispatchRows, ...answerRows].sort((a, b) =>
        b.content_created_at.localeCompare(a.content_created_at)
      )
      return { data: combined.slice(offset, offset + limit), error: null }
    }

    // set_current_answer — added so admin hide/restore and a member's
    // own Discovery-selection action can be exercised together against
    // ONE coherent questionAnswers state (final pre-apply correction,
    // item 6's cross-cutting scenario). Mirrors the real RPC exactly,
    // including item 1/4's fix: the demotion UPDATE never touches a
    // hidden row.
    if (fn === 'set_current_answer') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      const answerId = params?.p_answer_id as string
      // Question source-of-truth correction: no canonical/slug
      // restriction — any of the member's own visible answers, to any
      // Question, may become their one featured Minds answer.
      const target = questionAnswers.find(
        (qa) => qa.id === answerId && qa.user_id === viewerId && qa.moderation_status === 'visible'
      )
      if (!target) {
        return {
          data: null,
          error: {
            message: 'Only one of your own, visible answers can be shown in Minds.',
            code: 'P0001',
          },
        }
      }
      // NEW (item 1/4): never demote a hidden row.
      for (const qa of questionAnswers) {
        if (qa.user_id === viewerId && qa.id !== answerId && qa.moderation_status === 'visible') {
          qa.is_current = false
        }
      }
      target.is_current = true
      return { data: target, error: null }
    }

    if (fn === 'admin_list_questions') {
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      return {
        data: questions
          .slice()
          .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
          .map((q) => ({
            id: q.id,
            slug: q.slug,
            family: q.family ?? null,
            prompt: q.prompt,
            is_active: q.is_active,
            answer_count: questionAnswers.filter((qa) => qa.question_id === q.id).length,
            first_letter_count: 0,
            created_at: q.created_at ?? null,
          })),
        error: null,
      }
    }

    if (fn === 'admin_create_question') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const prompt = ((params?.p_prompt as string) ?? '').trim()
      if (prompt.length === 0) return { data: null, error: { message: 'A prompt is required.', code: 'P0001' } }
      const family = ((params?.p_family as string | null) ?? null) || null
      const newId = `q-created-${questions.length + 1}`
      questions.push({ id: newId, slug: null, prompt, is_active: false, family, created_at: new Date().toISOString() })
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'question_created',
        target_type: 'question',
        target_id: newId,
        target_identifier_snapshot: prompt,
        reason: null,
        metadata: { family },
        created_at: new Date().toISOString(),
      })
      return { data: newId, error: null }
    }

    if (fn === 'admin_replace_question') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const old = questions.find((q) => q.id === (params?.p_question_id as string))
      if (!old) return { data: null, error: { message: 'Question not found.', code: 'P0001' } }
      const newPrompt = ((params?.p_new_prompt as string) ?? '').trim()
      if (newPrompt.length === 0) return { data: null, error: { message: 'A prompt is required.', code: 'P0001' } }
      // Question source-of-truth correction, item 3: mirrors the OLD
      // Question's active state at call time unless the admin
      // explicitly overrides it — computed BEFORE the old row is
      // touched below.
      const oldActiveAtCallTime = old.is_active
      const newActive =
        params?.p_new_active === null || params?.p_new_active === undefined
          ? oldActiveAtCallTime
          : Boolean(params?.p_new_active)
      const deactivateOld = params?.p_deactivate_old === undefined ? true : Boolean(params?.p_deactivate_old)
      if (deactivateOld) old.is_active = false
      const newId = `q-replaced-${questions.length + 1}`
      questions.push({
        id: newId,
        slug: null,
        prompt: newPrompt,
        is_active: newActive,
        family: old.family ?? null,
        created_at: new Date().toISOString(),
      })
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'question_replaced',
        target_type: 'question',
        target_id: newId,
        target_identifier_snapshot: newPrompt,
        reason: null,
        metadata: {
          replaced_question_id: old.id,
          replaced_prompt: old.prompt,
          old_deactivated: deactivateOld,
          new_active: newActive,
        },
        created_at: new Date().toISOString(),
      })
      return { data: newId, error: null }
    }

    if (fn === 'admin_set_question_active') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      // Final pre-apply correction item 7: reject null before any
      // lookup or state change.
      if (params?.p_active === null || params?.p_active === undefined) {
        return { data: null, error: { message: 'An active state is required.', code: 'P0001' } }
      }
      const q = questions.find((q) => q.id === (params?.p_question_id as string))
      if (!q) return { data: null, error: { message: 'Question not found.', code: 'P0001' } }
      const active = params?.p_active as boolean
      // Final mutation-boundary audit item 6: idempotency guard — a
      // no-op transition is a clear error, never a fabricated audit row.
      if (q.is_active === active) {
        return {
          data: null,
          error: {
            message: active ? 'This Question is already active.' : 'This Question is already inactive.',
            code: 'P0001',
          },
        }
      }
      q.is_active = active
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: active ? 'question_activated' : 'question_deactivated',
        target_type: 'question',
        target_id: q.id,
        target_identifier_snapshot: q.prompt,
        reason: null,
        metadata: { is_active: active },
        created_at: new Date().toISOString(),
      })
      return { data: null, error: null }
    }

    if (fn === 'admin_update_question_prompt') {
      if (!viewerId) return { data: null, error: { message: 'Authentication required.', code: '42501' } }
      if (!isStaff(viewerId, 'admin')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const q = questions.find((q) => q.id === (params?.p_question_id as string))
      if (!q) return { data: null, error: { message: 'Question not found.', code: 'P0001' } }
      // Independent review item 8: must be deactivated first, not just
      // answer_count = 0 — an active Question is still being offered.
      if (q.is_active) {
        return {
          data: null,
          error: { message: 'This Question is currently active. Deactivate it before editing the prompt.', code: 'P0001' },
        }
      }
      const prompt = ((params?.p_prompt as string) ?? '').trim()
      if (prompt.length === 0) return { data: null, error: { message: 'A prompt is required.', code: 'P0001' } }
      if (questionAnswers.some((qa) => qa.question_id === q.id)) {
        return {
          data: null,
          error: { message: 'This Question already has answers and its prompt cannot be changed.', code: 'P0001' },
        }
      }
      q.prompt = prompt
      auditLog.push({
        id: `audit-${auditLog.length + 1}`,
        actor_id: viewerId,
        actor_identifier_snapshot: pseudonymOf(viewerId) ?? viewerId,
        action: 'question_updated',
        target_type: 'question',
        target_id: q.id,
        target_identifier_snapshot: prompt,
        reason: null,
        metadata: null,
        created_at: new Date().toISOString(),
      })
      return { data: null, error: null }
    }

    if (fn === 'admin_list_content_audit') {
      if (!isStaff(viewerId, 'moderator')) return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
      const targetType = (params?.p_target_type as string | null) ?? null
      const targetId = (params?.p_target_id as string | null) ?? null
      // Independent review item 2: admin may go global (null/null); a
      // moderator-only caller must supply a specific, reported target —
      // never a general proactive audit browse.
      if (!isStaff(viewerId, 'admin')) {
        if (targetType === null || targetId === null) {
          return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
        }
        if (!reports.some((r) => r.target_type === targetType && r.target_id === targetId)) {
          return { data: null, error: { message: 'Not authorized.', code: 'P0001' } }
        }
      }
      return {
        data: auditLog
          .filter((a) => targetType === null || a.target_type === targetType)
          .filter((a) => targetId === null || a.target_id === targetId)
          .slice()
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((a) => ({
            id: a.id,
            actor_identifier_snapshot: a.actor_identifier_snapshot,
            action: a.action,
            target_type: a.target_type,
            target_id: a.target_id,
            target_identifier_snapshot: a.target_identifier_snapshot,
            reason: a.reason,
            metadata: a.metadata,
            created_at: a.created_at,
          })),
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
    _dispatches: dispatches,
    _questions: questions,
    _questionAnswers: questionAnswers,
    _setViewer(id: string | null) {
      viewerId = id
    },
  }
}
