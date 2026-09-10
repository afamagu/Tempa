import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  hideDispatch,
  restoreDispatch,
  hideQuestionAnswer,
  restoreQuestionAnswer,
  listPublicContent,
  listContentAudit,
} from './admin-moderation'
import { getReport } from './admin'
import { reportContent } from './reports'
import { createFakeReports } from './__tests__/simulateReportRpcs'

const ADMIN = 'user-admin'
const MODERATOR = 'user-moderator'
const MEMBER = 'user-member'
const AUTHOR = 'user-author'

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

describe('admin_hide_dispatch / admin_restore_dispatch — moderator floor, reason required, reversible', () => {
  it('a non-staff member cannot hide a dispatch', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
    })
    const { error } = await hideDispatch(client(fake), 'd1', 'Testing')
    expect(error?.message).toBe('Not authorized.')
    expect(fake._dispatches[0].moderation_status).toBe('visible')
  })

  it('a moderator CANNOT hide an unreported Dispatch — report-driven access only (independent review item 1)', async () => {
    const fake = createFakeReports({
      viewerId: MODERATOR,
      profiles: [{ id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    const { error } = await hideDispatch(client(fake), 'd1', 'Just felt like it.')
    // Same generic message as "not staff at all" — never leaks report
    // existence to a caller who can't already see the reports queue.
    expect(error?.message).toBe('Not authorized.')
    expect(fake._dispatches[0].moderation_status).toBe('visible')
  })

  it('a moderator CAN hide, then restore, a REPORTED dispatch — reversible', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    fake._setViewer(MODERATOR)

    const hidden = await hideDispatch(client(fake), 'd1', 'Violates guidelines.')
    expect(hidden.error).toBeNull()
    expect(fake._dispatches[0].moderation_status).toBe('hidden')

    const restored = await restoreDispatch(client(fake), 'd1', 'Reviewed, was a false positive.')
    expect(restored.error).toBeNull()
    expect(fake._dispatches[0].moderation_status).toBe('visible')
  })

  it('an admin CAN proactively hide an eligible Dispatch with no report at all', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await hideDispatch(client(fake), 'd1', 'Proactive review finding.')
    expect(error).toBeNull()
    expect(fake._dispatches[0].moderation_status).toBe('hidden')
  })

  it('hide is rejected without a reason, even for a legitimately reported Dispatch', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    fake._setViewer(MODERATOR)
    const { error } = await hideDispatch(client(fake), 'd1', '   ')
    expect(error?.message).toBe('A reason is required.')
    expect(fake._dispatches[0].moderation_status).toBe('visible')
  })

  it('hiding writes a content_hidden audit row; restoring writes content_restored', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideDispatch(client(fake), 'd1', 'Reason one.')
    await restoreDispatch(client(fake), 'd1', 'Reason two.')
    expect(fake._auditLog.map((a) => a.action)).toEqual(['content_hidden', 'content_restored'])
    expect(fake._auditLog[0].target_type).toBe('dispatch')
    expect(fake._auditLog[0].reason).toBe('Reason one.')
  })

  it('idempotency: hiding an already-hidden Dispatch is a clear error, not a fabricated audit transition (independent review item 9)', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideDispatch(client(fake), 'd1', 'First hide.')
    const { error } = await hideDispatch(client(fake), 'd1', 'Second hide attempt.')
    expect(error?.message).toBe('This content is already hidden.')
    expect(fake._auditLog).toHaveLength(1)
  })

  it('idempotency: restoring an already-visible Dispatch is a clear error, not a fabricated audit transition', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await restoreDispatch(client(fake), 'd1', 'Nothing to restore.')
    expect(error?.message).toBe('This content is already visible.')
    expect(fake._auditLog).toHaveLength(0)
  })
})

describe('admin_hide_question_answer / admin_restore_question_answer — same shape as Dispatches', () => {
  it('a non-staff member cannot hide an answer', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: MEMBER, body: 'Autumn' }],
    })
    const { error } = await hideQuestionAnswer(client(fake), 'a1', 'Testing')
    expect(error?.message).toBe('Not authorized.')
    expect(fake._questionAnswers[0].moderation_status).toBe('visible')
  })

  it('a moderator CANNOT hide an unreported answer', async () => {
    const fake = createFakeReports({
      viewerId: MODERATOR,
      profiles: [{ id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    const { error } = await hideQuestionAnswer(client(fake), 'a1', 'Just felt like it.')
    expect(error?.message).toBe('Not authorized.')
    expect(fake._questionAnswers[0].moderation_status).toBe('visible')
  })

  it('a moderator CAN hide then restore a REPORTED answer, and it is reversible', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    fake._setViewer(MODERATOR)

    await hideQuestionAnswer(client(fake), 'a1', 'Inappropriate.')
    expect(fake._questionAnswers[0].moderation_status).toBe('hidden')
    await restoreQuestionAnswer(client(fake), 'a1', 'Appeal accepted.')
    expect(fake._questionAnswers[0].moderation_status).toBe('visible')
  })

  it('an admin CAN proactively hide an eligible answer with no report at all', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn' }],
      staff: { [ADMIN]: 'admin' },
    })
    const { error } = await hideQuestionAnswer(client(fake), 'a1', 'Proactive review finding.')
    expect(error).toBeNull()
    expect(fake._questionAnswers[0].moderation_status).toBe('hidden')
  })

  it('final pre-apply correction item 2: hiding a CURRENT answer also clears is_current, and records was_current in audit metadata', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', is_current: true }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideQuestionAnswer(client(fake), 'a1', 'Confirmed violation.')
    expect(fake._questionAnswers[0].moderation_status).toBe('hidden')
    expect(fake._questionAnswers[0].is_current).toBe(false)
    expect(fake._auditLog[0].metadata).toMatchObject({ was_current: true })
  })

  it('hiding an answer that was NOT current leaves is_current false — harmless, no misleading was_current: true', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', is_current: false }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideQuestionAnswer(client(fake), 'a1', 'Confirmed violation.')
    expect(fake._questionAnswers[0].is_current).toBe(false)
    expect(fake._auditLog[0].metadata).toMatchObject({ was_current: false })
  })

  it('final pre-apply correction item 3: restoring an answer does NOT restore is_current — the member must reselect it themselves', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', is_current: true }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideQuestionAnswer(client(fake), 'a1', 'Confirmed violation.')
    expect(fake._questionAnswers[0].is_current).toBe(false)

    await restoreQuestionAnswer(client(fake), 'a1', 'Appeal accepted.')
    expect(fake._questionAnswers[0].moderation_status).toBe('visible')
    expect(fake._questionAnswers[0].is_current).toBe(false)
  })
})

describe('final pre-apply correction item 6 — the exact cross-cutting hidden-answer-currentness scenario', () => {
  it('hide the current answer, member selects another, hidden answer stays frozen, restore does not reselect it, member can then reselect it', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [
        { id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true },
        { id: 'q2', slug: 'comfort-food', prompt: 'Comfort food?', is_active: true },
      ],
      questionAnswers: [
        { id: 'a', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', is_current: true },
        { id: 'b', question_id: 'q2', user_id: AUTHOR, body: 'Soup', is_current: false },
      ],
      staff: { [ADMIN]: 'admin' },
    })

    // Step 1-3: Admin hides Answer A (is_current true, visible).
    await hideQuestionAnswer(client(fake), 'a', 'Confirmed violation.')
    const a1 = fake._questionAnswers.find((qa) => qa.id === 'a')!
    expect(a1.moderation_status).toBe('hidden')
    expect(a1.is_current).toBe(false)

    // Step 4-5: the member (Author) sets visible Answer B current.
    fake._setViewer(AUTHOR)
    const setB = await client(fake).rpc('set_current_answer', { p_answer_id: 'b' })
    expect(setB.error).toBeNull()
    const b1 = fake._questionAnswers.find((qa) => qa.id === 'b')!
    expect(b1.is_current).toBe(true)

    // Step 6: Answer A remains hidden and is_current=false — the
    // set_current_answer call for B never touched it (item 1/4's fix).
    const a2 = fake._questionAnswers.find((qa) => qa.id === 'a')!
    expect(a2.moderation_status).toBe('hidden')
    expect(a2.is_current).toBe(false)

    // Step 7: no member RPC can mutate A while hidden — set_current_answer
    // itself refuses to target a hidden row directly.
    const trySetHidden = await client(fake).rpc('set_current_answer', { p_answer_id: 'a' })
    expect(trySetHidden.error?.message).toBe(
      'Only a completed answer to one of the three canonical Questions can be shown in Minds.'
    )

    // Step 8: restoring Answer A makes it visible but leaves is_current
    // false — restore never reselects it.
    fake._setViewer(ADMIN)
    await restoreQuestionAnswer(client(fake), 'a', 'Appeal accepted.')
    const a3 = fake._questionAnswers.find((qa) => qa.id === 'a')!
    expect(a3.moderation_status).toBe('visible')
    expect(a3.is_current).toBe(false)
    // B is still the member's current answer — restore didn't disturb it.
    expect(fake._questionAnswers.find((qa) => qa.id === 'b')!.is_current).toBe(true)

    // Step 9: the member can now explicitly reselect the restored A.
    fake._setViewer(AUTHOR)
    const reselectA = await client(fake).rpc('set_current_answer', { p_answer_id: 'a' })
    expect(reselectA.error).toBeNull()
    expect(fake._questionAnswers.find((qa) => qa.id === 'a')!.is_current).toBe(true)
    expect(fake._questionAnswers.find((qa) => qa.id === 'b')!.is_current).toBe(false)
  })

  it('a hidden, NON-current answer is untouched when another answer is selected current', async () => {
    const fake = createFakeReports({
      viewerId: AUTHOR,
      profiles: [{ id: AUTHOR, pseudonym: 'Author' }],
      questions: [
        { id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true },
        { id: 'q2', slug: 'comfort-food', prompt: 'Comfort food?', is_active: true },
      ],
      questionAnswers: [
        { id: 'a', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', is_current: false, moderation_status: 'hidden' },
        { id: 'b', question_id: 'q2', user_id: AUTHOR, body: 'Soup', is_current: false },
      ],
    })
    const { error } = await client(fake).rpc('set_current_answer', { p_answer_id: 'b' })
    expect(error).toBeNull()
    // a's moderation_status and is_current are both exactly as before —
    // the demotion UPDATE's moderation_status = 'visible' filter never
    // touched it.
    const a = fake._questionAnswers.find((qa) => qa.id === 'a')!
    expect(a.moderation_status).toBe('hidden')
    expect(a.is_current).toBe(false)
  })
})

describe('admin_list_public_content — admin floor only; a moderator cannot use proactive review', () => {
  function seeded(viewerId: string, staff?: Record<string, 'moderator' | 'admin'>) {
    return createFakeReports({
      viewerId,
      profiles: [{ id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [
        { id: 'd1', author_id: AUTHOR, title: 'Visible dispatch', body: 'Body one', status: 'published', published_at: '2026-09-01T00:00:00Z' },
        { id: 'd2', author_id: AUTHOR, title: 'Hidden dispatch', body: 'Body two', status: 'published', moderation_status: 'hidden', published_at: '2026-09-02T00:00:00Z' },
      ],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true }],
      questionAnswers: [
        { id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn', updated_at: '2026-09-03T00:00:00Z' },
      ],
      staff,
    })
  }

  it('a moderator is refused — proactive public-content surveillance is admin-only, report-driven access is separate', async () => {
    const fake = seeded(MODERATOR, { [MODERATOR]: 'moderator' })
    const { data, error } = await listPublicContent(client(fake))
    expect(error?.message).toBe('Not authorized.')
    expect(data).toEqual([])
  })

  it('a non-staff member is refused', async () => {
    const fake = seeded(MEMBER)
    const { error } = await listPublicContent(client(fake))
    expect(error?.message).toBe('Not authorized.')
  })

  it('an admin can list both content types, newest first, across the UNION', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data, error } = await listPublicContent(client(fake))
    expect(error).toBeNull()
    expect(data.map((r) => r.id)).toEqual(['a1', 'd2', 'd1'])
    expect(data.map((r) => r.contentType)).toEqual(['question_answer', 'dispatch', 'dispatch'])
  })

  it('filters by type and by status', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const onlyHidden = await listPublicContent(client(fake), { status: 'hidden' })
    expect(onlyHidden.data.map((r) => r.id)).toEqual(['d2'])

    const onlyDispatches = await listPublicContent(client(fake), { type: 'dispatch' })
    expect(onlyDispatches.data.every((r) => r.contentType === 'dispatch')).toBe(true)
  })

  it('never surfaces private letters, moments, or letter_postcards — only the two public content types', async () => {
    const fake = seeded(ADMIN, { [ADMIN]: 'admin' })
    const { data } = await listPublicContent(client(fake))
    for (const row of data) {
      expect(['dispatch', 'question_answer']).toContain(row.contentType)
    }
  })

  it('independent review item 7 (revised, final audit round): a VISIBLE answer to an inactive Question never appears, but a HIDDEN one remains reachable for moderation lifecycle management', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: AUTHOR, pseudonym: 'Author' }],
      questions: [
        { id: 'q1', slug: 'favorite-season', prompt: 'Favorite season?', is_active: true },
        { id: 'q2', slug: 'comfort-food', prompt: 'Comfort food?', is_active: false },
      ],
      questionAnswers: [
        { id: 'a-active', question_id: 'q1', user_id: AUTHOR, body: 'Active answer', updated_at: '2026-09-01T00:00:00Z' },
        { id: 'a-inactive', question_id: 'q2', user_id: AUTHOR, body: 'Historical answer', updated_at: '2026-09-02T00:00:00Z' },
        {
          id: 'a-inactive-hidden',
          question_id: 'q2',
          user_id: AUTHOR,
          body: 'Historical, hidden answer',
          moderation_status: 'hidden',
          updated_at: '2026-09-03T00:00:00Z',
        },
      ],
      staff: { [ADMIN]: 'admin' },
    })
    const all = await listPublicContent(client(fake))
    // a-inactive (visible, inactive Question) is excluded — never
    // "current public content." a-inactive-hidden (hidden, inactive
    // Question) IS included — a moderation record Admin can still
    // inspect/restore even after the Question was later deactivated.
    expect(all.data.map((r) => r.id).sort()).toEqual(['a-active', 'a-inactive-hidden'])

    // Filtering to Hidden surfaces the inactive Question's hidden
    // answer — it's exactly the row Admin needs to find here.
    const onlyHidden = await listPublicContent(client(fake), { status: 'hidden' })
    expect(onlyHidden.data.map((r) => r.id)).toEqual(['a-inactive-hidden'])

    // Filtering to Visible never surfaces the inactive Question's
    // visible answer — that one stays excluded regardless of filter.
    const onlyVisible = await listPublicContent(client(fake), { status: 'visible' })
    expect(onlyVisible.data.map((r) => r.id)).toEqual(['a-active'])
  })
})

describe('admin_list_content_audit — corrected per independent review item 2: admin can go global, moderator must be scoped to a reported target', () => {
  it('a non-staff member cannot read the audit log', async () => {
    const fake = createFakeReports({ viewerId: MEMBER, profiles: [{ id: MEMBER, pseudonym: 'Member' }] })
    const { error } = await listContentAudit(client(fake))
    expect(error?.message).toBe('Not authorized.')
  })

  it('a moderator CANNOT call with no target_type/target_id — no global proactive audit browsing', async () => {
    const fake = createFakeReports({
      viewerId: MODERATOR,
      profiles: [{ id: MODERATOR, pseudonym: 'Mod' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    const { error, data } = await listContentAudit(client(fake))
    expect(error?.message).toBe('Not authorized.')
    expect(data).toEqual([])
  })

  it('a moderator CANNOT call with a target_type/target_id that has never been reported', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin', [MODERATOR]: 'moderator' },
    })
    // Admin proactively hides d1 — no report exists for it.
    await hideDispatch(client(fake), 'd1', 'Proactive finding.')
    fake._setViewer(MODERATOR)
    const { error } = await listContentAudit(client(fake), { targetType: 'dispatch', targetId: 'd1' })
    expect(error?.message).toBe('Not authorized.')
  })

  it('a moderator CAN read audit history for a specific, reported target', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: MODERATOR, pseudonym: 'Mod' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    fake._setViewer(MODERATOR)
    await hideDispatch(client(fake), 'd1', 'Reported for spam.')
    const { data, error } = await listContentAudit(client(fake), { targetType: 'dispatch', targetId: 'd1' })
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data[0].action).toBe('content_hidden')
    expect(data[0].reason).toBe('Reported for spam.')
  })

  it('an admin CAN call with no target_type/target_id — global content-audit query', async () => {
    const fake = createFakeReports({
      viewerId: ADMIN,
      profiles: [{ id: ADMIN, pseudonym: 'Admin' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [ADMIN]: 'admin' },
    })
    await hideDispatch(client(fake), 'd1', 'Proactive finding.')
    const { data, error } = await listContentAudit(client(fake))
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})

describe('report detail (admin_get_report) — target_moderation_status reflects live hide/restore state', () => {
  it('reports the current moderation status of a reported dispatch, and it updates after Hide', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: AUTHOR, pseudonym: 'Author' }, { id: MODERATOR, pseudonym: 'Mod' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'T', body: 'B', status: 'published' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    fake._setViewer(MODERATOR)
    const before = await getReport(client(fake), fake._reports[0].id)
    expect(before.data?.targetModerationStatus).toBe('visible')

    await hideDispatch(client(fake), 'd1', 'Confirmed violation.')
    const after = await getReport(client(fake), fake._reports[0].id)
    expect(after.data?.targetModerationStatus).toBe('hidden')
  })

  it('a profile report has a null target_moderation_status — the field only applies to Dispatch/answer', async () => {
    const fake = createFakeReports({
      viewerId: MEMBER,
      profiles: [{ id: MEMBER, pseudonym: 'Member' }, { id: AUTHOR, pseudonym: 'Author' }, { id: MODERATOR, pseudonym: 'Mod' }],
      staff: { [MODERATOR]: 'moderator' },
    })
    await reportContent(client(fake), 'profile', AUTHOR, 'harassment', '')
    fake._setViewer(MODERATOR)
    const { data } = await getReport(client(fake), fake._reports[0].id)
    expect(data?.targetModerationStatus).toBeNull()
  })
})
