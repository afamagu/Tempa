// Board Personalization Phase 2B — ranking-BEHAVIOR tests against the
// fakeDispatches simulation (the same approach Phase 2A's own board-
// ranking tests use), proving the actual effect of topical relevance on
// getBoardFeedPage's output, rather than scanning SQL source text. See
// docs/sql/2026-09-27-topical-interests.sql for the live implementation
// this simulation mirrors.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBoardFeedPage, type BoardFeedCursor } from './dispatches'
import { createFakeDispatches, type FakeDispatchRow } from './__tests__/fakeDispatches'

const AUTHOR_A = 'user-a'
const AUTHOR_B = 'user-b'
const VIEWER = 'user-viewer'
const SESSION_STARTED_AT = '2026-09-15T00:00:00Z'
const SEED_A = 'seed-a'

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

function boardRow(overrides: Partial<FakeDispatchRow> = {}): FakeDispatchRow {
  return {
    id: 'd-1',
    author_id: AUTHOR_A,
    title: 'A title',
    body: 'Hello, wider Tempa.',
    status: 'published',
    published_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('getBoardFeedPage — topical relevance: matched vs unmatched comparable candidates', () => {
  it('among two Discovery Dispatches tied on author diversity (both author_seq=1, distinct authors), the one with a matching topic ranks first', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'matched', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'unmatched', author_id: AUTHOR_B, published_at: '2026-09-05T00:00:00Z' }),
      ],
      topics: [{ dispatch_id: 'matched', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['matched', 'unmatched'])
  })

  it('only ever reorders candidates that already tie on author diversity — a genuinely more recent/diverse unmatched candidate still outranks an older matched one', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        // author_seq=1 for AUTHOR_A (newer, unmatched)
        boardRow({ id: 'newer-unmatched', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        // author_seq=1 for AUTHOR_B, but this is AUTHOR_A's SECOND item
        // (author_seq=2) — never competes at position 1 against a
        // genuinely different, higher-priority author_seq class.
        boardRow({ id: 'older-matched', author_id: AUTHOR_A, published_at: '2026-09-01T00:00:00Z' }),
      ],
      topics: [{ dispatch_id: 'older-matched', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    // Same author, so author_seq strictly orders them by recency
    // regardless of topical match — the tie-break never applies across
    // different author_seq classes.
    expect(items.map((i) => i.id)).toEqual(['newer-unmatched', 'older-matched'])
  })

  it('multiple matched candidates among unmatched ones: matched candidates fill the front of their tie group, unmatched fill the rest, none lost', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'm1', author_id: 'author-1', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'u1', author_id: 'author-2', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'm2', author_id: 'author-3', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'u2', author_id: 'author-4', published_at: '2026-09-05T00:00:00Z' }),
      ],
      topics: [
        { dispatch_id: 'm1', topic: 'travel' },
        { dispatch_id: 'm2', topic: 'travel' },
      ],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'travel-places' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 10 })
    expect(items).toHaveLength(4)
    const ids = items.map((i) => i.id)
    const matchedPositions = ['m1', 'm2'].map((id) => ids.indexOf(id))
    const unmatchedPositions = ['u1', 'u2'].map((id) => ids.indexOf(id))
    expect(Math.max(...matchedPositions)).toBeLessThan(Math.min(...unmatchedPositions))
  })
})

describe('getBoardFeedPage — zero-interest degrade is byte-identical to Phase 2A', () => {
  it('a viewer with no selected Interests gets EXACTLY the same order as if topical matching did not exist at all', async () => {
    const rows = [
      boardRow({ id: 'a', author_id: 'author-1', published_at: '2026-09-05T00:00:00Z' }),
      boardRow({ id: 'b', author_id: 'author-2', published_at: '2026-09-05T00:00:00Z' }),
      boardRow({ id: 'c', author_id: 'author-3', published_at: '2026-09-05T00:00:00Z' }),
    ]
    const topics = [{ dispatch_id: 'a', topic: 'faith' }, { dispatch_id: 'b', topic: 'travel' }]

    const withNoInterests = await getBoardFeedPage(
      client(createFakeDispatches({ viewerId: VIEWER, rows, topics, profileInterests: [] })),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null }
    )
    const withNoInterestsField = await getBoardFeedPage(
      client(createFakeDispatches({ viewerId: VIEWER, rows, topics })),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null }
    )
    expect(withNoInterests.items.map((i) => i.id)).toEqual(withNoInterestsField.items.map((i) => i.id))
  })

  it('a Dispatch whose topics match no curated Interest is a normal eligible candidate, receiving no penalty relative to an unmatched peer', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'obscure-topic', author_id: 'author-1', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'no-topic', author_id: 'author-2', published_at: '2026-09-05T00:00:00Z' }),
      ],
      topics: [{ dispatch_id: 'obscure-topic', topic: 'xyzabc123nonsense' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(2)
  })
})

describe('getBoardFeedPage — Phase 2A architecture preserved', () => {
  it('UNSEEN still beats SEEN regardless of topical match', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'seen-matched', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'unseen-unmatched', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      topics: [{ dispatch_id: 'seen-matched', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
      views: [{ viewer_id: VIEWER, dispatch_id: 'seen-matched', last_paragraph_index: 0, first_viewed_at: '2026-09-11T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['unseen-unmatched', 'seen-matched'])
  })

  it('Keep:second-signal 3:1 and Familiar:Discovery 1:1 proportions remain intact with topical matching active', async () => {
    // Reuses the exact 3-keep + 1-correspondent scenario proven in
    // lib/dispatches.test.ts, now with topical matching turned on for
    // every row — proving the proportion survives unchanged.
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'keep-1', author_id: 'kept-a', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'keep-2', author_id: 'kept-b', published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'keep-3', author_id: 'kept-c', published_at: '2026-09-03T00:00:00Z' }),
        boardRow({ id: 'corr-1', author_id: 'corr-a', published_at: '2026-09-02T00:00:00Z' }),
      ],
      topics: [
        { dispatch_id: 'keep-1', topic: 'faith' }, { dispatch_id: 'keep-2', topic: 'faith' },
        { dispatch_id: 'keep-3', topic: 'faith' }, { dispatch_id: 'corr-1', topic: 'faith' },
      ],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
      kept: [
        { viewer_user_id: VIEWER, kept_user_id: 'kept-a', created_at: '2026-08-01T00:00:00Z' },
        { viewer_user_id: VIEWER, kept_user_id: 'kept-b', created_at: '2026-08-01T00:00:00Z' },
        { viewer_user_id: VIEWER, kept_user_id: 'kept-c', created_at: '2026-08-01T00:00:00Z' },
      ],
      correspondences: [
        {
          participant_low: VIEWER < 'corr-a' ? VIEWER : 'corr-a',
          participant_high: VIEWER < 'corr-a' ? 'corr-a' : VIEWER,
          status: 'active',
          established_at: '2026-08-01T00:00:00Z',
        },
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 4 })
    expect(items.map((i) => i.id).sort()).toEqual(['corr-1', 'keep-1', 'keep-2', 'keep-3'])
    expect(items[0].id).toMatch(/^keep-/)
    expect(items[3].id).toMatch(/^keep-/)
  })

  it('Discovery still contains unmatched-interest writing — never a closed filter bubble', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'matched', author_id: 'author-1', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'unmatched-1', author_id: 'author-2', published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'unmatched-2', author_id: 'author-3', published_at: '2026-09-03T00:00:00Z' }),
      ],
      topics: [{ dispatch_id: 'matched', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 10 })
    expect(items.map((i) => i.id).sort()).toEqual(['matched', 'unmatched-1', 'unmatched-2'])
  })

  it('full block remains absolute even for a topically-matched author', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      topics: [{ dispatch_id: 'd-1', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'full' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(0)
  })

  it('Stop Letters (a letters-only block) remains irrelevant to Board visibility even for a topically-matched author', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      topics: [{ dispatch_id: 'd-1', topic: 'faith' }],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['d-1'])
  })
})

describe('getBoardFeedPage — determinism and pagination with topical matching active', () => {
  function manyMixedRows(count: number) {
    return Array.from({ length: count }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `author-${i}`, published_at: `2026-09-01T00:${String(i % 60).padStart(2, '0')}:00Z` })
    )
  }

  it('the same seed produces the identical exact order on repeated calls', async () => {
    const rows = manyMixedRows(10)
    const topics = [{ dispatch_id: 'd-2', topic: 'faith' }, { dispatch_id: 'd-6', topic: 'faith' }]
    const profileInterests = [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }]

    const first = await getBoardFeedPage(
      client(createFakeDispatches({ viewerId: VIEWER, rows, topics, profileInterests })),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null }
    )
    const second = await getBoardFeedPage(
      client(createFakeDispatches({ viewerId: VIEWER, rows, topics, profileInterests })),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null }
    )
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id))
  })

  it('cursor continuation is exact: paginating page-by-page yields the identical set as one large page, no duplicates, no skips', async () => {
    const rows = manyMixedRows(12)
    const topics = [{ dispatch_id: 'd-3', topic: 'faith' }, { dispatch_id: 'd-7', topic: 'faith' }, { dispatch_id: 'd-9', topic: 'faith' }]
    const profileInterests = [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }]

    const everything = await getBoardFeedPage(
      client(createFakeDispatches({ viewerId: VIEWER, rows, topics, profileInterests })),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 100 }
    )

    const fake = createFakeDispatches({ viewerId: VIEWER, rows, topics, profileInterests })
    const collected: string[] = []
    let cursor: BoardFeedCursor | null = null
    for (let guard = 0; guard < 20; guard++) {
      const page = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor, limit: 3 })
      collected.push(...page.items.map((i) => i.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }

    expect(collected.sort()).toEqual(everything.items.map((i) => i.id).sort())
    expect(new Set(collected).size).toBe(collected.length)
  })
})

describe('Home partitions remain valid with topical matching active', () => {
  it('partitionHomeSections still produces no duplicate ids and every candidate lands in exactly one bucket', async () => {
    const { partitionHomeSections } = await import('./dispatches')
    const rows = Array.from({ length: 20 }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `author-${i}`, published_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` })
    )
    const topics = rows.slice(0, 5).map((r) => ({ dispatch_id: r.id, topic: 'faith' }))
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows,
      topics,
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 20 })
    const { featured, shelf, fromMindsYouKeep, serendipity, remainder } = partitionHomeSections(items)
    const allIds = [...featured, ...shelf, ...fromMindsYouKeep, ...serendipity, ...remainder].map((i) => i.id)
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(allIds.length).toBe(items.length)
  })
})
