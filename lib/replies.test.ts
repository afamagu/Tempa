import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getDispatchReplies,
  orderRepliesForDisplay,
  filterOrphanedThreads,
  replyBodyError,
  createReply,
  deleteReply,
  REPLY_MAX_CHARS,
  type Reply,
} from './replies'
import { createFakeDispatches, type FakeDispatchRow, type FakeReplyRow } from './__tests__/fakeDispatches'

const AUTHOR_A = 'user-a'
const AUTHOR_B = 'user-b'
const AUTHOR_C = 'user-c'
const VIEWER = 'user-viewer'

function dispatchRow(overrides: Partial<FakeDispatchRow> = {}): FakeDispatchRow {
  return {
    id: 'd-1',
    author_id: AUTHOR_A,
    title: 'A title',
    body: 'Hello, wider Tempa.',
    status: 'published',
    published_at: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}

function replyRow(overrides: Partial<FakeReplyRow> = {}): FakeReplyRow {
  return {
    id: 'r-1',
    dispatch_id: 'd-1',
    author_id: AUTHOR_B,
    body: 'A thoughtful response.',
    created_at: '2026-09-07T01:00:00Z',
    ...overrides,
  }
}

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

// ============================================================
// replyBodyError — pure client-side mirror of create_reply's own checks
// ============================================================
describe('replyBodyError', () => {
  it('rejects blank', () => {
    expect(replyBodyError('')).toBe('A Reply needs some writing.')
    expect(replyBodyError('   ')).toBe('A Reply needs some writing.')
  })

  it(`rejects more than ${REPLY_MAX_CHARS} characters (trimmed)`, () => {
    expect(replyBodyError('a'.repeat(REPLY_MAX_CHARS + 1))).toBe('Reply is too long.')
  })

  it(`accepts exactly ${REPLY_MAX_CHARS} characters`, () => {
    expect(replyBodyError('a'.repeat(REPLY_MAX_CHARS))).toBeNull()
  })

  it('accepts ordinary writing', () => {
    expect(replyBodyError('Thank you for sharing this.')).toBeNull()
  })
})

// ============================================================
// orderRepliesForDisplay — the pure one-level-grouping function
// ============================================================
describe('orderRepliesForDisplay', () => {
  function reply(overrides: Partial<Reply>): Reply {
    return {
      id: 'x',
      dispatchId: 'd-1',
      authorId: AUTHOR_A,
      authorPseudonym: 'Someone',
      authorCountry: null,
      body: 'text',
      parentReplyId: null,
      rootReplyId: null,
      replyToUserId: null,
      replyToPseudonym: null,
      isDeleted: false,
      createdAt: '2026-09-07T00:00:00Z',
      ...overrides,
    }
  }

  it('orders top-level threads oldest-first', () => {
    const items = [
      reply({ id: 'newer-thread', createdAt: '2026-09-08T00:00:00Z' }),
      reply({ id: 'older-thread', createdAt: '2026-09-01T00:00:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    expect(result.map((r) => r.id)).toEqual(['older-thread', 'newer-thread'])
  })

  it('groups all descendants beneath their thread, regardless of real parent depth, ahead of a later-starting thread', () => {
    const items = [
      reply({ id: 'A', createdAt: '2026-09-01T00:00:00Z' }), // root
      reply({ id: 'D', parentReplyId: 'C', rootReplyId: 'A', createdAt: '2026-09-01T00:03:00Z' }),
      reply({ id: 'B', parentReplyId: 'A', rootReplyId: 'A', createdAt: '2026-09-01T00:01:00Z' }),
      reply({ id: 'E', createdAt: '2026-09-02T00:00:00Z' }), // a later-starting, separate top-level thread
      reply({ id: 'C', parentReplyId: 'B', rootReplyId: 'A', createdAt: '2026-09-01T00:02:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    // Thread A (A, B, C, D, chronological) entirely before thread E,
    // even though A/B/C/D were supplied out of order and D's own true
    // parent chain is 3 hops deep.
    expect(result.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('is a stable, deterministic total order (id as final tiebreak for identical timestamps)', () => {
    const items = [
      reply({ id: 'z', createdAt: '2026-09-01T00:00:00Z' }),
      reply({ id: 'a', createdAt: '2026-09-01T00:00:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    expect(result.map((r) => r.id)).toEqual(['a', 'z'])
  })

  // ============================================================
  // Pre-SQL correction pass, Issue 3: root groups must render by the
  // ROOT's own created_at, never by root_reply_id (a random UUID) —
  // COALESCE(root_reply_id, id) is NOT a chronological ordering key.
  // These root ids are deliberately chosen so alphabetical/UUID order
  // is the EXACT OPPOSITE of chronological order, so a regression back
  // to sorting by id/root_reply_id would fail this test immediately.
  // ============================================================
  it('orders root groups by the root\'s actual created_at, NOT by root id/UUID — deliberately non-chronological ids', () => {
    const items = [
      // 'zzz-...' sorts AFTER 'aaa-...' alphabetically, but was created
      // FIRST chronologically — the opposite of UUID/lexicographic order.
      reply({ id: 'zzz-root-created-first', createdAt: '2026-09-01T00:00:00Z' }),
      reply({ id: 'aaa-root-created-second', createdAt: '2026-09-05T00:00:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    expect(result.map((r) => r.id)).toEqual(['zzz-root-created-first', 'aaa-root-created-second'])
  })

  it('orders descendants within a non-chronologically-named root group by their own created_at, not by id', () => {
    const items = [
      reply({ id: 'zzz-root', createdAt: '2026-09-01T00:00:00Z' }),
      // Descendant ids are also chosen to sort in the OPPOSITE order of
      // their real created_at timestamps.
      reply({ id: 'zzz-child-newest', parentReplyId: 'zzz-root', rootReplyId: 'zzz-root', createdAt: '2026-09-01T00:05:00Z' }),
      reply({ id: 'aaa-child-oldest', parentReplyId: 'zzz-root', rootReplyId: 'zzz-root', createdAt: '2026-09-01T00:01:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    expect(result.map((r) => r.id)).toEqual(['zzz-root', 'aaa-child-oldest', 'zzz-child-newest'])
  })

  it('three independent root groups with non-chronological ids all render oldest-thread-first, each internally chronological', () => {
    const items = [
      reply({ id: 'root-c', createdAt: '2026-09-15T00:00:00Z' }),
      reply({ id: 'root-a', createdAt: '2026-09-01T00:00:00Z' }),
      reply({ id: 'reply-to-a-2', parentReplyId: 'root-a', rootReplyId: 'root-a', createdAt: '2026-09-01T01:00:00Z' }),
      reply({ id: 'root-b', createdAt: '2026-09-08T00:00:00Z' }),
      reply({ id: 'reply-to-a-1', parentReplyId: 'root-a', rootReplyId: 'root-a', createdAt: '2026-09-01T00:30:00Z' }),
    ]
    const result = orderRepliesForDisplay(items)
    expect(result.map((r) => r.id)).toEqual(['root-a', 'reply-to-a-1', 'reply-to-a-2', 'root-b', 'root-c'])
  })

  it('a 3+ hop reply-to-reply-to-reply chain all share the SAME rootReplyId — the data layer\'s own basis for one visual indentation level, never a staircase', () => {
    const items = [
      reply({ id: 'A', createdAt: '2026-09-01T00:00:00Z' }), // root
      reply({ id: 'B', parentReplyId: 'A', rootReplyId: 'A', createdAt: '2026-09-01T00:01:00Z' }), // 1 hop
      reply({ id: 'C', parentReplyId: 'B', rootReplyId: 'A', createdAt: '2026-09-01T00:02:00Z' }), // 2 hops
      reply({ id: 'D', parentReplyId: 'C', rootReplyId: 'A', createdAt: '2026-09-01T00:03:00Z' }), // 3 hops
    ]
    const result = orderRepliesForDisplay(items)
    // Chronological within the one thread...
    expect(result.map((r) => r.id)).toEqual(['A', 'B', 'C', 'D'])
    // ...and every descendant, regardless of true hop depth, shares the
    // exact same rootReplyId — there is no per-hop "depth" value anywhere
    // for a renderer to staircase on.
    expect(result.find((r) => r.id === 'B')!.rootReplyId).toBe('A')
    expect(result.find((r) => r.id === 'C')!.rootReplyId).toBe('A')
    expect(result.find((r) => r.id === 'D')!.rootReplyId).toBe('A')
  })
})

// ============================================================
// filterOrphanedThreads — final pre-SQL security review, hidden-root
// structural audit. A moderator-hidden root Reply is entirely absent
// from RLS's own SELECT result for anyone but its own author; its still-
// visible descendants (rootReplyId pointing at that now-absent id) must
// be suppressed as a whole thread, never rendered floating with no
// anchor. Pure function — no fake Supabase client needed.
// ============================================================
describe('filterOrphanedThreads', () => {
  function reply(overrides: Partial<Reply>): Reply {
    return {
      id: 'x',
      dispatchId: 'd-1',
      authorId: AUTHOR_A,
      authorPseudonym: 'Someone',
      authorCountry: null,
      body: 'text',
      parentReplyId: null,
      rootReplyId: null,
      replyToUserId: null,
      replyToPseudonym: null,
      isDeleted: false,
      createdAt: '2026-09-07T00:00:00Z',
      ...overrides,
    }
  }

  it('keeps every top-level Reply (rootReplyId null) unconditionally', () => {
    const items = [reply({ id: 'A' }), reply({ id: 'E' })]
    expect(filterOrphanedThreads(items).map((r) => r.id)).toEqual(['A', 'E'])
  })

  it('keeps descendants whose root IS present in the set', () => {
    const items = [
      reply({ id: 'A' }),
      reply({ id: 'B', parentReplyId: 'A', rootReplyId: 'A' }),
      reply({ id: 'C', parentReplyId: 'B', rootReplyId: 'A' }),
    ]
    expect(filterOrphanedThreads(items).map((r) => r.id)).toEqual(['A', 'B', 'C'])
  })

  it('suppresses every descendant of a root that is absent from the set (moderator-hidden root, ordinary viewer)', () => {
    // A itself is not in this array at all — RLS already excluded it —
    // but B and C, its still-visible descendants, carry rootReplyId 'A'.
    const items = [
      reply({ id: 'B', parentReplyId: 'A', rootReplyId: 'A' }),
      reply({ id: 'C', parentReplyId: 'B', rootReplyId: 'A' }),
      reply({ id: 'E' }), // an unrelated, unaffected top-level thread
    ]
    expect(filterOrphanedThreads(items).map((r) => r.id)).toEqual(['E'])
  })

  it('does not suppress anything when the "root" is a tombstoned (member-deleted) Reply that is still present', () => {
    const items = [
      reply({ id: 'A', isDeleted: true, body: '' }),
      reply({ id: 'B', parentReplyId: 'A', rootReplyId: 'A' }),
    ]
    expect(filterOrphanedThreads(items).map((r) => r.id)).toEqual(['A', 'B'])
  })
})

// ============================================================
// getDispatchReplies — read path, visibility, and identity resolution
// ============================================================
describe('getDispatchReplies', () => {
  it('resolves the true parent as reply_to, not the root, for a deeply nested Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [
        { id: AUTHOR_A, pseudonym: 'Evening Quill' },
        { id: AUTHOR_B, pseudonym: 'Salt Harbor' },
        { id: AUTHOR_C, pseudonym: 'Quiet Ember' },
      ],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A, created_at: '2026-09-07T01:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A, created_at: '2026-09-07T01:01:00Z' }),
        replyRow({ id: 'C', author_id: AUTHOR_C, parent_reply_id: 'B', root_reply_id: 'A', reply_to_user_id: AUTHOR_B, created_at: '2026-09-07T01:02:00Z' }),
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    const c = replies.find((r) => r.id === 'C')!
    expect(c.replyToUserId).toBe(AUTHOR_B)
    expect(c.replyToPseudonym).toBe('Salt Harbor')
    expect(c.rootReplyId).toBe('A')
  })

  it('a top-level Reply has null parent/root/reply-to', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [{ id: AUTHOR_B, pseudonym: 'Salt Harbor' }],
      replies: [replyRow({ id: 'A' })],
    })
    const [reply] = await getDispatchReplies(client(fake), 'd-1')
    expect(reply.parentReplyId).toBeNull()
    expect(reply.rootReplyId).toBeNull()
    expect(reply.replyToUserId).toBeNull()
    expect(reply.replyToPseudonym).toBeNull()
  })

  it('excludes Replies whose Dispatch is unpublished', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow({ status: 'unpublished' })],
      replies: [replyRow()],
    })
    expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
  })

  it('excludes a moderator-hidden Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'visible-1' }), replyRow({ id: 'hidden-1', moderation_status: 'hidden' })],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id)).toEqual(['visible-1'])
  })

  it('excludes a Reply from a suspended author, but includes one from a restricted author', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'from-suspended', author_id: AUTHOR_B }),
        replyRow({ id: 'from-restricted', author_id: AUTHOR_C }),
      ],
      accountStatus: { [AUTHOR_B]: 'suspended', [AUTHOR_C]: 'restricted' },
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id)).toEqual(['from-restricted'])
  })

  it('a full block hides a Reply; a letters-only block does not', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'from-full-blocked', author_id: AUTHOR_B }),
        replyRow({ id: 'from-letters-blocked', author_id: AUTHOR_C }),
      ],
      blocked: [
        { blocker_id: VIEWER, blocked_id: AUTHOR_B, scope: 'full' },
        { blocker_id: VIEWER, blocked_id: AUTHOR_C, scope: 'letters' },
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id)).toEqual(['from-letters-blocked'])
  })

  it('a member always sees their own Reply, even while their own account is suspended', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'own', author_id: VIEWER })],
      accountStatus: { [VIEWER]: 'suspended' },
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id)).toEqual(['own'])
  })

  it('a member-deleted (tombstoned) Reply remains in results with an empty body, isDeleted true', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'gone', body: '', deleted_at: '2026-09-07T02:00:00Z' })],
    })
    const [reply] = await getDispatchReplies(client(fake), 'd-1')
    expect(reply.isDeleted).toBe(true)
    expect(reply.body).toBe('')
  })

  it('a descendant of a tombstoned Reply survives and keeps its own reply-to identity', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A, body: '', deleted_at: '2026-09-07T02:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A, created_at: '2026-09-07T01:01:00Z' }),
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id).sort()).toEqual(['A', 'B'])
    const b = replies.find((r) => r.id === 'B')!
    expect(b.rootReplyId).toBe('A')
    expect(b.replyToPseudonym).toBe('Evening Quill')
  })

  // ============================================================
  // Final pre-SQL security review — hidden-root structural audit,
  // end-to-end through the real RLS simulation + filterOrphanedThreads +
  // orderRepliesForDisplay pipeline (not just the pure unit tests above).
  // ============================================================
  it('a moderator-hidden ROOT Reply and its surviving visible descendants are entirely suppressed for an ordinary viewer', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A, moderation_status: 'hidden', created_at: '2026-09-07T01:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A, created_at: '2026-09-07T01:01:00Z' }),
        replyRow({ id: 'C', author_id: AUTHOR_C, parent_reply_id: 'B', root_reply_id: 'A', reply_to_user_id: AUTHOR_B, created_at: '2026-09-07T01:02:00Z' }),
        replyRow({ id: 'E', author_id: AUTHOR_A, created_at: '2026-09-07T01:03:00Z' }), // unrelated top-level thread
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    // A is invisible (moderator-hidden, viewer isn't its author), and
    // B/C — its only anchor — go with it. E, an unrelated thread, is
    // completely unaffected.
    expect(replies.map((r) => r.id)).toEqual(['E'])
  })

  it('a moderator-hidden root remains visible to its OWN author, so their own descendants stay attached for them specifically', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A, moderation_status: 'hidden', created_at: '2026-09-07T01:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A, created_at: '2026-09-07T01:01:00Z' }),
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id).sort()).toEqual(['A', 'B'])
  })

  it('a member-tombstoned ROOT Reply stays visible (as a tombstone) with its descendants normally attached — NOT suppressed', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A, body: '', deleted_at: '2026-09-07T02:00:00Z', created_at: '2026-09-07T01:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A, created_at: '2026-09-07T01:01:00Z' }),
      ],
    })
    const replies = await getDispatchReplies(client(fake), 'd-1')
    expect(replies.map((r) => r.id)).toEqual(['A', 'B'])
    expect(replies.find((r) => r.id === 'A')!.isDeleted).toBe(true)
    expect(replies.find((r) => r.id === 'B')!.rootReplyId).toBe('A')
  })

  // ============================================================
  // Final pre-SQL security/verifier correction, Defect 1 — the Reply's
  // parent-Dispatch gate must require the Dispatch to be CURRENTLY,
  // genuinely public (published + moderator-visible + not full-blocked
  // + author publicly visible), with NO own-author bypass on that gate.
  // ============================================================
  describe('the parent-Dispatch visibility gate has no own-author bypass', () => {
    it('published, visible parent + a normal Reply -> visible', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ status: 'published' })],
        replies: [replyRow({ id: 'r-1' })],
      })
      expect((await getDispatchReplies(client(fake), 'd-1')).map((r) => r.id)).toEqual(['r-1'])
    })

    it('an unpublished parent Dispatch hides its Replies from an ordinary viewer', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ status: 'unpublished' })],
        replies: [replyRow({ id: 'r-1' })],
      })
      expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
    })

    it('a moderator-hidden parent Dispatch hides its Replies', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ moderation_status: 'hidden' })],
        replies: [replyRow({ id: 'r-1' })],
      })
      expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
    })

    it('a suspended parent-Dispatch author hides its Replies; a restricted author does not', async () => {
      const fakeSuspended = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ id: 'd-suspended', author_id: AUTHOR_A })],
        replies: [replyRow({ id: 'r-1', dispatch_id: 'd-suspended' })],
        accountStatus: { [AUTHOR_A]: 'suspended' },
      })
      expect(await getDispatchReplies(client(fakeSuspended), 'd-suspended')).toHaveLength(0)

      const fakeRestricted = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ id: 'd-restricted', author_id: AUTHOR_A })],
        replies: [replyRow({ id: 'r-2', dispatch_id: 'd-restricted' })],
        accountStatus: { [AUTHOR_A]: 'restricted' },
      })
      expect((await getDispatchReplies(client(fakeRestricted), 'd-restricted')).map((r) => r.id)).toEqual(['r-2'])
    })

    it('a full block against the parent Dispatch author hides its Replies; a letters-only block does not', async () => {
      const fakeFull = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ id: 'd-full', author_id: AUTHOR_A })],
        replies: [replyRow({ id: 'r-1', dispatch_id: 'd-full' })],
        blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'full' }],
      })
      expect(await getDispatchReplies(client(fakeFull), 'd-full')).toHaveLength(0)

      const fakeLettersOnly = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ id: 'd-letters', author_id: AUTHOR_A })],
        replies: [replyRow({ id: 'r-2', dispatch_id: 'd-letters' })],
        blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
      })
      expect((await getDispatchReplies(client(fakeLettersOnly), 'd-letters')).map((r) => r.id)).toEqual(['r-2'])
    })

    it('the Dispatch author does NOT see their own draft Dispatch\'s Replies — the own-author read exception does not extend to Replies', async () => {
      const fake = createFakeDispatches({
        viewerId: AUTHOR_A,
        rows: [dispatchRow({ author_id: AUTHOR_A, status: 'unpublished' })],
        replies: [replyRow({ id: 'r-1', author_id: AUTHOR_B })],
      })
      expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
    })

    it('a member does NOT see their OWN Reply if the parent Dispatch is unpublished — own-Reply visibility never bypasses the parent gate', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ status: 'unpublished' })],
        replies: [replyRow({ id: 'own-reply', author_id: VIEWER })],
      })
      expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
    })

    it('a member does NOT see their OWN Reply if the parent Dispatch is moderator-hidden — own-Reply visibility never bypasses the parent gate', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ moderation_status: 'hidden' })],
        replies: [replyRow({ id: 'own-reply', author_id: VIEWER })],
      })
      expect(await getDispatchReplies(client(fake), 'd-1')).toHaveLength(0)
    })
  })
})

// ============================================================
// createReply — the sole write path
// ============================================================
describe('createReply', () => {
  it('a top-level Reply has null parent/root/reply-to', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).toBeNull()
    expect(fake._replies).toHaveLength(1)
    expect(fake._replies[0].parent_reply_id).toBeNull()
    expect(fake._replies[0].root_reply_id).toBeNull()
    expect(fake._replies[0].reply_to_user_id).toBeNull()
  })

  it('a nested Reply derives reply_to_user_id from the TRUE parent, and root_reply_id from the parent\'s own root (single-hop, even for a 3-deep chain)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'A', author_id: AUTHOR_A }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: AUTHOR_A }),
      ],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Replying to B.', parentReplyId: 'B' })
    expect(error).toBeNull()
    const created = fake._replies.find((r) => r.parent_reply_id === 'B')!
    expect(created.reply_to_user_id).toBe(AUTHOR_B)
    expect(created.root_reply_id).toBe('A')
  })

  it('rejects an unauthenticated caller', async () => {
    const fake = createFakeDispatches({ viewerId: null, rows: [dispatchRow()] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error?.message).toBe('Authentication required.')
  })

  it.each(['restricted', 'suspended', 'banned'] as const)('rejects when the caller\'s own account status is %s', async (status) => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      accountStatus: { [VIEWER]: status },
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
  })

  it('an active caller is allowed', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()], accountStatus: { [VIEWER]: 'active' } })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).toBeNull()
  })

  it('rejects a blank body', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: '   ' })
    expect(error).not.toBeNull()
  })

  it('rejects a body over 500 characters', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'a'.repeat(501) })
    expect(error).not.toBeNull()
  })

  it('rejects replying to an unpublished Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ status: 'unpublished' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
  })

  it('rejects replying to a moderator-hidden Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ moderation_status: 'hidden' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
  })

  it('replying to your own PUBLISHED, visible Dispatch is allowed', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ author_id: VIEWER, status: 'published' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Thanks for reading.' })
    expect(error).toBeNull()
  })

  // Pre-SQL correction pass, Issue 2: there is NO own-author exception
  // for Reply-creation eligibility — the read-time "author can see their
  // own draft/hidden Dispatch" allowance must never leak into whether
  // that Dispatch can be replied to.
  it('rejects replying to your OWN unpublished/draft Dispatch — no own-author exception for creating a Reply', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ author_id: VIEWER, status: 'unpublished' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
    expect(error?.message).toBe('This Dispatch is not open to Replies right now.')
  })

  it('rejects replying to your OWN moderator-hidden Dispatch — no own-author exception for creating a Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow({ author_id: VIEWER, moderation_status: 'hidden' })],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
    expect(error?.message).toBe('This Dispatch is not open to Replies right now.')
  })

  it('somebody else\'s published, visible Dispatch is repliable subject to normal account/block rules', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ author_id: AUTHOR_A, status: 'published' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).toBeNull()
  })

  it('somebody else\'s unpublished Dispatch is rejected, exactly like your own would be', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ author_id: AUTHOR_A, status: 'unpublished' })] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error?.message).toBe('This Dispatch is not open to Replies right now.')
  })

  it('replying to your own Reply is allowed', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'own', author_id: VIEWER })],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Following up.', parentReplyId: 'own' })
    expect(error).toBeNull()
  })

  it('rejects when the Dispatch author has a FULL block with the caller', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow({ author_id: AUTHOR_A })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'full' }],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).not.toBeNull()
  })

  it('does NOT reject when the Dispatch author has only a letters-only block with the caller', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow({ author_id: AUTHOR_A })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(error).toBeNull()
  })

  it('rejects when the PARENT Reply\'s author has a FULL block with the caller', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'A', author_id: AUTHOR_B })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_B, scope: 'full' }],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
    expect(error).not.toBeNull()
  })

  it('rejects when the parent Reply belongs to a DIFFERENT Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow({ id: 'd-1' }), dispatchRow({ id: 'd-2', author_id: AUTHOR_A })],
      replies: [replyRow({ id: 'A', dispatch_id: 'd-2' })],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
    expect(error).not.toBeNull()
  })

  it('rejects a parent Reply id that does not exist', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'does-not-exist' })
    expect(error).not.toBeNull()
  })

  it('rejects replying to a moderator-hidden parent Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'A', moderation_status: 'hidden' })],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
    expect(error).not.toBeNull()
  })

  it('rejects replying to a member-deleted (tombstoned) parent Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'A', body: '', deleted_at: '2026-09-07T02:00:00Z' })],
    })
    const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
    expect(error).not.toBeNull()
  })

  it('the created Reply\'s author is always the viewer — there is no parameter through which a caller could supply a different author', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
    expect(fake._replies[0].author_id).toBe(VIEWER)
  })

  // ============================================================
  // Final pre-SQL security/verifier correction, Defect 2 — create_reply
  // is SECURITY DEFINER (bypasses RLS entirely), so it must explicitly
  // reproduce author_content_publicly_visible for BOTH the Dispatch
  // author and, when replying to a Reply, that Reply's own author.
  // ============================================================
  describe('Dispatch-author and parent-Reply-author public-visibility checks', () => {
    it.each(['suspended', 'banned'] as const)('rejects replying to a Dispatch whose author is %s', async (status) => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ author_id: AUTHOR_A })],
        accountStatus: { [AUTHOR_A]: status },
      })
      const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
      expect(error).not.toBeNull()
    })

    it.each(['active', 'restricted'] as const)('allows replying to a Dispatch whose author is %s', async (status) => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ author_id: AUTHOR_A })],
        accountStatus: { [AUTHOR_A]: status },
      })
      const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.' })
      expect(error).toBeNull()
    })

    it.each(['suspended', 'banned'] as const)('rejects replying to a parent Reply whose author is %s', async (status) => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow()],
        replies: [replyRow({ id: 'A', author_id: AUTHOR_B })],
        accountStatus: { [AUTHOR_B]: status },
      })
      const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
      expect(error).not.toBeNull()
    })

    it.each(['active', 'restricted'] as const)('allows replying to a parent Reply whose author is %s', async (status) => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow()],
        replies: [replyRow({ id: 'A', author_id: AUTHOR_B })],
        accountStatus: { [AUTHOR_B]: status },
      })
      const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Hello.', parentReplyId: 'A' })
      expect(error).toBeNull()
    })

    it('a Dispatch author replying to their OWN published Dispatch is unaffected by this check (their own account status is already gated earlier)', async () => {
      const fake = createFakeDispatches({
        viewerId: VIEWER,
        rows: [dispatchRow({ author_id: VIEWER, status: 'published' })],
        accountStatus: { [VIEWER]: 'active' },
      })
      const { error } = await createReply(client(fake), { safetyEvaluationId: 'test-eval-id', dispatchId: 'd-1', body: 'Thanks for reading.' })
      expect(error).toBeNull()
    })
  })
})

// ============================================================
// deleteReply — member's own tombstone
// ============================================================
describe('deleteReply', () => {
  it('the author can remove their own Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'mine', author_id: VIEWER })],
    })
    const { error } = await deleteReply(client(fake), 'mine')
    expect(error).toBeNull()
    expect(fake._replies[0].deleted_at).not.toBeNull()
    expect(fake._replies[0].body).toBe('')
  })

  it('rejects removing someone else\'s Reply', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'not-mine', author_id: AUTHOR_B })],
    })
    const { error } = await deleteReply(client(fake), 'not-mine')
    expect(error).not.toBeNull()
    expect(fake._replies[0].deleted_at).toBeNull()
  })

  it('never touches parent_reply_id/root_reply_id/reply_to_user_id/created_at/id — descendants keep resolving', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [
        replyRow({ id: 'A', author_id: VIEWER, created_at: '2026-09-07T01:00:00Z' }),
        replyRow({ id: 'B', author_id: AUTHOR_B, parent_reply_id: 'A', root_reply_id: 'A', reply_to_user_id: VIEWER }),
      ],
    })
    await deleteReply(client(fake), 'A')
    const a = fake._replies.find((r) => r.id === 'A')!
    expect(a.id).toBe('A')
    expect(a.created_at).toBe('2026-09-07T01:00:00Z')
    const b = fake._replies.find((r) => r.id === 'B')!
    expect(b.parent_reply_id).toBe('A')
    expect(b.root_reply_id).toBe('A')
    expect(b.reply_to_user_id).toBe(VIEWER)
  })

  it('never a hard delete — no row disappears from the underlying store', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      replies: [replyRow({ id: 'mine', author_id: VIEWER })],
    })
    await deleteReply(client(fake), 'mine')
    expect(fake._replies).toHaveLength(1)
  })
})
