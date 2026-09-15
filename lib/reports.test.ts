import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reportContent } from './reports'
import { createFakeReports } from './__tests__/simulateReportRpcs'

const SOURCE_PATH = path.join(__dirname, 'reports.ts')
const source = readFileSync(SOURCE_PATH, 'utf8')

const REPORTER = 'user-reporter'
const SENDER = 'user-sender'

function client(fake: ReturnType<typeof createFakeReports>) {
  return fake as unknown as SupabaseClient
}

describe('reportContent — thin RPC wrapper (pre-beta minimum safety build)', () => {
  it('rejects when unauthenticated', async () => {
    const fake = createFakeReports({ viewerId: null })
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Authentication required.')
  })

  it('a valid report succeeds', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'spam', 'Sent me a link.')
    expect(error).toBeNull()
    expect(fake._reports).toHaveLength(1)
  })

  it('rejects an unknown target type', async () => {
    const fake = createFakeReports({ viewerId: REPORTER })
    // @ts-expect-error deliberately invalid for this test
    const { error } = await reportContent(client(fake), 'comment', SENDER, 'spam', '')
    expect(error).not.toBeNull()
  })

  it('rejects an unknown reason', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: SENDER, pseudonym: 'Sender' }],
    })
    // @ts-expect-error deliberately invalid for this test
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'because', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Unknown report reason.')
  })

  it('rejects a target that does not exist', async () => {
    const fake = createFakeReports({ viewerId: REPORTER, profiles: [] })
    const { error } = await reportContent(client(fake), 'profile', 'nobody', 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Member not found.')
  })

  it('rejects reporting your own content (self-report)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }],
    })
    const { error } = await reportContent(client(fake), 'profile', REPORTER, 'spam', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('You cannot report your own content.')
  })

  it('rejects a second report of the same target by the same reporter (duplicate protection)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    await reportContent(client(fake), 'profile', SENDER, 'spam', '')
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'harassment', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('You have already reported this.')
    expect(fake._reports).toHaveLength(1)
  })

  it('a different reporter against the SAME target is not blocked by another reporter\'s duplicate guard', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: 'user-second-reporter', pseudonym: 'Second' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
    })
    await reportContent(client(fake), 'profile', SENDER, 'spam', '')

    fake._setViewer('user-second-reporter')
    const { error } = await reportContent(client(fake), 'profile', SENDER, 'harassment', '')

    expect(error).toBeNull()
    expect(fake._reports).toHaveLength(2)
  })

  it('reported_user_id is derived server-side from the letter\'s sender, never from a client-supplied value', async () => {
    // The wrapper's own call signature has no reported-user parameter at
    // all — this is a structural guarantee, not just a runtime one.
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
    })
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    expect(fake._reports[0].reported_user_id).toBe(SENDER)
    expect(fake._reports[0].reported_user_id).not.toBe(REPORTER)
  })

  it('a non-participant cannot report a letter they are not party to', async () => {
    const fake = createFakeReports({
      viewerId: 'user-outsider',
      profiles: [{ id: SENDER, pseudonym: 'Sender' }],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
    })
    const { error } = await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    expect(error).not.toBeNull()
    expect(error?.message).toBe('Letter not found.')
  })

  it('the frozen evidence snapshot for a Letter contains the body, sender pseudonym, and the letter\'s own created_at — never a live pointer back to the letter itself', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Something upsetting.', created_at: '2026-09-01T12:00:00Z' }],
    })
    await reportContent(client(fake), 'letter', 'letter-1', 'harassment', '')
    expect(fake._reports[0].evidence_snapshot).toEqual({
      body: 'Something upsetting.',
      sender_pseudonym: 'Sender',
      letter_created_at: '2026-09-01T12:00:00Z',
    })
  })

  it('reported_user_id for a photo Moment is derived from the letter it belongs to, not supplied by the caller', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [
        { id: REPORTER, pseudonym: 'Reporter' },
        { id: SENDER, pseudonym: 'Sender' },
      ],
      letters: [{ id: 'letter-1', sender_id: SENDER, recipient_id: REPORTER, body: 'Hello' }],
      moments: [{ id: 'moment-1', letter_id: 'letter-1', type: 'photo', image_path: 'letter-photos/x/y.jpg' }],
    })
    const { error } = await reportContent(client(fake), 'photo_moment', 'moment-1', 'inappropriate_content', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(SENDER)
  })

  it('trims context and sends null when blank, never an empty string', async () => {
    let capturedContext: unknown
    const fake = {
      async rpc(fn: string, params?: Record<string, unknown>) {
        capturedContext = params?.p_context
        return { data: null, error: null }
      },
    }
    await reportContent(fake as unknown as SupabaseClient, 'profile', SENDER, 'other', '   ')
    expect(capturedContext).toBeNull()
  })

  it('never touches blocking — reporting and blocking are fully independent actions', () => {
    expect(source).not.toContain('blocked_users')
    expect(source).not.toContain('block_user')
    expect(source).not.toContain("from '@/lib/blocking'")
  })

  it('the reason enum presents scam/fraud with the required international-platform wording', async () => {
    const { REPORT_REASONS } = await import('./reports')
    const scamFraud = REPORT_REASONS.find((r) => r.value === 'scam_fraud')
    expect(scamFraud?.label).toBe('Scam, fraud or money request')
  })
})

describe('reportContent — dispatch target (independent review item 3)', () => {
  const AUTHOR = 'user-dispatch-author'

  it('accepts a published, visible Dispatch as a report target', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'published' }],
    })
    const { error } = await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(AUTHOR)
  })

  it('a HIDDEN Dispatch cannot be reported by a stale/guessed id — resolves to the same "not found" as a nonexistent one', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'published', moderation_status: 'hidden' }],
    })
    const { error } = await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    expect(error?.message).toBe('Dispatch not found.')
    expect(fake._reports).toHaveLength(0)
  })

  it('an unpublished Dispatch is likewise not reportable', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'unpublished' }],
    })
    const { error } = await reportContent(client(fake), 'dispatch', 'd1', 'harassment', '')
    expect(error?.message).toBe('Dispatch not found.')
  })
})

describe('reportContent — photo_moment target, dispatch-sourced half (independent review item 3)', () => {
  const AUTHOR = 'user-dispatch-author'

  it('accepts a Moment on a published, visible Dispatch', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'published' }],
      dispatchMoments: [{ id: 'dm-1', dispatch_id: 'd1', image_path: 'author-a/photo.jpg' }],
    })
    const { error } = await reportContent(client(fake), 'photo_moment', 'dm-1', 'inappropriate_content', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(AUTHOR)
  })

  it('a Moment under a HIDDEN Dispatch cannot be reported — the parent Dispatch must be published and visible', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'published', moderation_status: 'hidden' }],
      dispatchMoments: [{ id: 'dm-1', dispatch_id: 'd1', image_path: 'author-a/photo.jpg' }],
    })
    const { error } = await reportContent(client(fake), 'photo_moment', 'dm-1', 'inappropriate_content', '')
    expect(error?.message).toBe('Photo not found.')
    expect(fake._reports).toHaveLength(0)
  })

  it('private-letter Photo Moment reporting is unchanged by this correction — participant access still governs it, not Dispatch predicates', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: 'user-sender-2', pseudonym: 'Sender' }],
      letters: [{ id: 'letter-1', sender_id: 'user-sender-2', recipient_id: REPORTER, body: 'Hello' }],
      moments: [{ id: 'moment-1', letter_id: 'letter-1', type: 'photo', image_path: 'letter-photos/x/y.jpg' }],
    })
    const { error } = await reportContent(client(fake), 'photo_moment', 'moment-1', 'inappropriate_content', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe('user-sender-2')
  })
})

describe('reportContent — question_answer target (Admin Phase 2A-1, Decision 1)', () => {
  const AUTHOR = 'user-answer-author'

  it('accepts a visible answer to an active Question as a report target', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn, no contest.' }],
    })
    const { error } = await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    expect(error).toBeNull()
    expect(fake._reports).toHaveLength(1)
    expect(fake._reports[0].reported_user_id).toBe(AUTHOR)
  })

  it('the frozen evidence snapshot contains the prompt, the answer body, and the author pseudonym', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Autumn Fan' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn, no contest.' }],
    })
    await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    expect(fake._reports[0].evidence_snapshot).toEqual({
      prompt: 'What is your favorite season?',
      body: 'Autumn, no contest.',
      author_pseudonym: 'Autumn Fan',
    })
  })

  it('rejects self-reporting your own answer', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: REPORTER, body: 'Winter.' }],
    })
    const { error } = await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    expect(error?.message).toBe('You cannot report your own content.')
  })

  it('rejects a second report of the same answer by the same reporter (duplicate protection preserved)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn.' }],
    })
    await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    const { error } = await reportContent(client(fake), 'question_answer', 'a1', 'spam', '')
    expect(error?.message).toBe('You have already reported this.')
    expect(fake._reports).toHaveLength(1)
  })

  it('rejects a nonexistent answer id', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [],
    })
    const { error } = await reportContent(client(fake), 'question_answer', 'does-not-exist', 'harassment', '')
    expect(error?.message).toBe('Answer not found.')
  })

  it('rejects an answer whose Question is inactive — inaccessible target, same as a hidden or nonexistent one', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'comfort-food', prompt: 'What is your comfort food?', is_active: false }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Soup.' }],
    })
    const { error } = await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    expect(error?.message).toBe('Answer not found.')
  })

  it('rejects an answer that is already hidden — cannot report a target you could no longer legitimately see', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      questions: [{ id: 'q1', slug: 'favorite-season', prompt: 'What is your favorite season?', is_active: true }],
      questionAnswers: [{ id: 'a1', question_id: 'q1', user_id: AUTHOR, body: 'Autumn.', moderation_status: 'hidden' }],
    })
    const { error } = await reportContent(client(fake), 'question_answer', 'a1', 'harassment', '')
    expect(error?.message).toBe('Answer not found.')
  })
})

describe('reportContent — reply target (Board Experience Phase 2B)', () => {
  const AUTHOR = 'user-reply-author'

  it('accepts a visible Reply as a report target', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: AUTHOR, title: 'A title', body: 'A body', status: 'published' }],
      replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: 'A thoughtful reply.' }],
    })
    const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(AUTHOR)
  })

  it('the frozen evidence snapshot contains the Reply body, author pseudonym, Dispatch context, and parent relationship', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Quiet Ember' }],
      dispatches: [{ id: 'd1', author_id: 'user-dispatch-author', title: 'Evening thoughts', body: 'A body', status: 'published' }],
      replies: [
        { id: 'parent-1', dispatch_id: 'd1', author_id: 'user-other', body: 'The original reply.' },
        { id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: 'Something upsetting.', parent_reply_id: 'parent-1' },
      ],
    })
    await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    expect(fake._reports[0].evidence_snapshot).toEqual({
      body: 'Something upsetting.',
      author_pseudonym: 'Quiet Ember',
      dispatch_id: 'd1',
      dispatch_title: 'Evening thoughts',
      parent_reply_id: 'parent-1',
    })
  })

  it('rejects self-reporting your own Reply', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }],
      dispatches: [{ id: 'd1', author_id: 'user-dispatch-author', title: 'A title', body: 'A body', status: 'published' }],
      replies: [{ id: 'r1', dispatch_id: 'd1', author_id: REPORTER, body: 'My own reply.' }],
    })
    const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    expect(error?.message).toBe('You cannot report your own content.')
  })

  it('rejects a second report of the same Reply by the same reporter (duplicate protection preserved)', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: 'user-dispatch-author', title: 'A title', body: 'A body', status: 'published' }],
      replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: 'A reply.' }],
    })
    await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    const { error } = await reportContent(client(fake), 'reply', 'r1', 'spam', '')
    expect(error?.message).toBe('You have already reported this.')
    expect(fake._reports).toHaveLength(1)
  })

  it('rejects a nonexistent Reply id', async () => {
    const fake = createFakeReports({ viewerId: REPORTER, profiles: [{ id: REPORTER, pseudonym: 'Reporter' }] })
    const { error } = await reportContent(client(fake), 'reply', 'does-not-exist', 'harassment', '')
    expect(error?.message).toBe('Reply not found.')
  })

  it('rejects a Reply that is already moderator-hidden', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: 'user-dispatch-author', title: 'A title', body: 'A body', status: 'published' }],
      replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: 'A reply.', moderation_status: 'hidden' }],
    })
    const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    expect(error?.message).toBe('Reply not found.')
  })

  it('a member-deleted Reply REMAINS reportable — deleting a Reply must never be usable to evade an in-flight report', async () => {
    const fake = createFakeReports({
      viewerId: REPORTER,
      profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }],
      dispatches: [{ id: 'd1', author_id: 'user-dispatch-author', title: 'A title', body: 'A body', status: 'published' }],
      // moderation_status stays 'visible' — the fake, like the real
      // schema, only ever gates reportability on moderation_status; a
      // member-deleted-but-not-moderator-hidden Reply is still visible
      // by that definition, with whatever context remains.
      replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: '' }],
    })
    const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
    expect(error).toBeNull()
    expect(fake._reports[0].reported_user_id).toBe(AUTHOR)
  })

  // ============================================================
  // Final pre-SQL security/verifier correction, Defect 3 — report_
  // content's reply branch must match the SAME full visibility boundary
  // dispatch_replies_select_published enforces: both the Reply's own
  // state AND its parent Dispatch's own full public-visibility gate.
  // ============================================================
  describe('the reply branch matches Reply readability exactly', () => {
    const DISPATCH_AUTHOR = 'user-dispatch-author'

    function setup(overrides: {
      dispatchOverrides?: Partial<{ status: 'published' | 'unpublished'; moderation_status: 'visible' | 'hidden' }>
      blocked?: { blocker_id: string; blocked_id: string; scope?: 'letters' | 'full' }[]
      authorAccountStatus?: Record<string, 'active' | 'restricted' | 'suspended' | 'banned'>
    } = {}) {
      return createFakeReports({
        viewerId: REPORTER,
        profiles: [
          { id: REPORTER, pseudonym: 'Reporter' },
          { id: AUTHOR, pseudonym: 'Author' },
          { id: DISPATCH_AUTHOR, pseudonym: 'Dispatch Author' },
        ],
        dispatches: [
          {
            id: 'd1',
            author_id: DISPATCH_AUTHOR,
            title: 'A title',
            body: 'A body',
            status: 'published',
            ...overrides.dispatchOverrides,
          },
        ],
        replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: 'A reply.' }],
        blocked: overrides.blocked,
        authorAccountStatus: overrides.authorAccountStatus,
      })
    }

    it('rejects reporting a Reply on an unpublished parent Dispatch', async () => {
      const fake = setup({ dispatchOverrides: { status: 'unpublished' } })
      const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
      expect(error?.message).toBe('Reply not found.')
    })

    it('rejects reporting a Reply on a moderator-hidden parent Dispatch', async () => {
      const fake = setup({ dispatchOverrides: { moderation_status: 'hidden' } })
      const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
      expect(error?.message).toBe('Reply not found.')
    })

    it('rejects reporting a Reply when the parent Dispatch author is full-blocked; a letters-only block does not affect it', async () => {
      const fakeFull = setup({ blocked: [{ blocker_id: REPORTER, blocked_id: DISPATCH_AUTHOR, scope: 'full' }] })
      const rejected = await reportContent(client(fakeFull), 'reply', 'r1', 'harassment', '')
      expect(rejected.error?.message).toBe('Reply not found.')

      const fakeLettersOnly = setup({ blocked: [{ blocker_id: REPORTER, blocked_id: DISPATCH_AUTHOR, scope: 'letters' }] })
      const allowed = await reportContent(client(fakeLettersOnly), 'reply', 'r1', 'harassment', '')
      expect(allowed.error).toBeNull()
    })

    it('rejects reporting a Reply when the parent Dispatch author is suspended/banned; active/restricted is unaffected', async () => {
      const fakeSuspended = setup({ authorAccountStatus: { [DISPATCH_AUTHOR]: 'suspended' } })
      const rejected = await reportContent(client(fakeSuspended), 'reply', 'r1', 'harassment', '')
      expect(rejected.error?.message).toBe('Reply not found.')

      const fakeRestricted = setup({ authorAccountStatus: { [DISPATCH_AUTHOR]: 'restricted' } })
      const allowed = await reportContent(client(fakeRestricted), 'reply', 'r1', 'harassment', '')
      expect(allowed.error).toBeNull()
    })

    it('rejects reporting a Reply when the REPLY\'s own author is full-blocked; a letters-only block does not affect it', async () => {
      const fakeFull = setup({ blocked: [{ blocker_id: REPORTER, blocked_id: AUTHOR, scope: 'full' }] })
      const rejected = await reportContent(client(fakeFull), 'reply', 'r1', 'harassment', '')
      expect(rejected.error?.message).toBe('Reply not found.')

      const fakeLettersOnly = setup({ blocked: [{ blocker_id: REPORTER, blocked_id: AUTHOR, scope: 'letters' }] })
      const allowed = await reportContent(client(fakeLettersOnly), 'reply', 'r1', 'harassment', '')
      expect(allowed.error).toBeNull()
    })

    it('rejects reporting a Reply when the REPLY\'s own author is suspended/banned; active/restricted is unaffected', async () => {
      const fakeSuspended = setup({ authorAccountStatus: { [AUTHOR]: 'banned' } })
      const rejected = await reportContent(client(fakeSuspended), 'reply', 'r1', 'harassment', '')
      expect(rejected.error?.message).toBe('Reply not found.')

      const fakeRestricted = setup({ authorAccountStatus: { [AUTHOR]: 'restricted' } })
      const allowed = await reportContent(client(fakeRestricted), 'reply', 'r1', 'harassment', '')
      expect(allowed.error).toBeNull()
    })

    it('a member-deleted Reply on an otherwise fully-visible Dispatch/author stays reportable even under the widened checks', async () => {
      const fake = createFakeReports({
        viewerId: REPORTER,
        profiles: [{ id: REPORTER, pseudonym: 'Reporter' }, { id: AUTHOR, pseudonym: 'Author' }, { id: DISPATCH_AUTHOR, pseudonym: 'Dispatch Author' }],
        dispatches: [{ id: 'd1', author_id: DISPATCH_AUTHOR, title: 'A title', body: 'A body', status: 'published' }],
        replies: [{ id: 'r1', dispatch_id: 'd1', author_id: AUTHOR, body: '' }],
      })
      const { error } = await reportContent(client(fake), 'reply', 'r1', 'harassment', '')
      expect(error).toBeNull()
    })
  })
})
