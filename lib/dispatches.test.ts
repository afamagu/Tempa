import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getPublishedDispatches,
  getPublishedDispatchesByAuthor,
  getDispatchById,
  publishDispatch,
  searchDispatches,
  dispatchExcerpt,
  dispatchIsRich,
  dispatchTitleError,
  normalizeTopics,
  sortBoardDispatches,
  interleaveByAuthor,
  clampReadingPosition,
  isKeepingMind,
  keepMind,
  unkeepMind,
  shareDispatch,
  revokeDispatchShare,
  getActiveDispatchShare,
  getSharedDispatch,
  getHomeBoardDispatches,
  updateDispatch,
  deleteDispatch,
  pinDispatch,
  unpinDispatch,
  getPinnedDispatch,
} from './dispatches'
import { docToPlainBody, RICH_BODY_MARKER } from './letter-editor-doc'
import { blockUser, unblockUser } from './blocking'
import { createFakeDispatches, type FakeDispatchRow } from './__tests__/fakeDispatches'

const AUTHOR_A = 'user-a'
const AUTHOR_B = 'user-b'
const VIEWER = 'user-viewer'

function row(overrides: Partial<FakeDispatchRow> = {}): FakeDispatchRow {
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

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

describe('getPublishedDispatches — Board pool', () => {
  it('1. only published Dispatches appear', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'published-1', status: 'published' }), row({ id: 'unpublished-1', status: 'unpublished' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
    })

    const result = await getPublishedDispatches(client(fake))
    expect(result.map((r) => r.id)).toEqual(['published-1'])
  })

  it('carries the author\'s country through for the compact flag, and null when unset — never city/region/coordinates', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'has-country', author_id: AUTHOR_A }),
        row({ id: 'no-country', author_id: AUTHOR_B }),
      ],
      profiles: [
        { id: AUTHOR_A, pseudonym: 'Evening Quill', country: 'France' },
        { id: AUTHOR_B, pseudonym: 'Quiet Harbor' },
      ],
    })
    const result = await getPublishedDispatches(client(fake))
    expect(result.find((r) => r.id === 'has-country')?.authorCountry).toBe('France')
    expect(result.find((r) => r.id === 'no-country')?.authorCountry).toBeNull()
  })

  it('an unpublished Dispatch never appears publicly, even to a different viewer', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'draft-ish', status: 'unpublished', author_id: AUTHOR_A })],
    })
    expect(await getPublishedDispatches(client(fake))).toHaveLength(0)
  })

  it('3. author identity is preserved correctly across multiple authors', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'a-1', author_id: AUTHOR_A, published_at: '2026-09-07T01:00:00Z' }),
        row({ id: 'b-1', author_id: AUTHOR_B, published_at: '2026-09-07T02:00:00Z' }),
      ],
      profiles: [
        { id: AUTHOR_A, pseudonym: 'Evening Quill' },
        { id: AUTHOR_B, pseudonym: 'Salt Harbor' },
      ],
    })
    const result = await getPublishedDispatches(client(fake))
    const byId = new Map(result.map((r) => [r.id, r.authorPseudonym]))
    expect(byId.get('a-1')).toBe('Evening Quill')
    expect(byId.get('b-1')).toBe('Salt Harbor')
  })

  it('fetches each Dispatch\'s topics correctly', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-topics' })],
      topics: [
        { dispatch_id: 'd-topics', topic: 'ritual' },
        { dispatch_id: 'd-topics', topic: 'memory' },
      ],
    })
    const [result] = await getPublishedDispatches(client(fake))
    expect(result.topics).toEqual(['ritual', 'memory'])
  })
})

describe('getPublishedDispatchesByAuthor — profile integration', () => {
  it('12. never exposes another status\'s row through the per-author query', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'a-published', author_id: AUTHOR_A, status: 'published' }),
        row({ id: 'a-unpublished', author_id: AUTHOR_A, status: 'unpublished' }),
      ],
    })
    const result = await getPublishedDispatchesByAuthor(client(fake), AUTHOR_A)
    expect(result.map((r) => r.id)).toEqual(['a-published'])
  })
})

describe('getDispatchById — reader', () => {
  it('12. an unpublished Dispatch is invisible to anyone but its author', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'hidden', status: 'unpublished', author_id: AUTHOR_A })],
    })
    expect(await getDispatchById(client(fake), 'hidden')).toBeNull()
  })

  it('an author can see their own unpublished Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'own-draft', status: 'unpublished', author_id: AUTHOR_A })],
    })
    expect((await getDispatchById(client(fake), 'own-draft'))?.id).toBe('own-draft')
  })
})

describe('publishDispatch', () => {
  it('2. requires a title — blank is rejected', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), { title: '   ', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toContain('needs a title')
  })

  it('2. title max length is enforced', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'x'.repeat(71),
      body: 'x',
      topics: [],
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('too long')
  })

  it('a title at exactly 70 characters succeeds', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'x'.repeat(70),
      body: 'A long-form Dispatch.',
      topics: [],
    })
    expect(error).toBeNull()
    expect(data?.title).toHaveLength(70)
  })

  it('a successful publish returns the new row, authored by the caller', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'A letter to whoever finds it',
      body: 'A letter to whoever finds it.',
      topics: ['ritual'],
    })
    expect(error).toBeNull()
    expect(data?.authorId).toBe(AUTHOR_A)
  })

  // Checkpoint 1C, test category F — the live-tested
  // dispatches_published_at_required regression: a successful publish
  // must always carry a non-null publishedAt, and title+body+topics+
  // Moment must land together in the one publish call (the SQL
  // migration's single transaction), not require a second write.
  it('F. a publish with topics AND a Moment together succeeds atomically with a non-null publishedAt', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'A quiet morning ritual',
      body: 'A short Dispatch with a photo.',
      topics: ['ritual', 'memory'],
      moments: [{ position: 0, imagePath: `${AUTHOR_A}/photo.jpg` }],
    })
    expect(error).toBeNull()
    expect(data?.publishedAt).toBeTruthy()
    const stored = await getDispatchById(client(fake), data!.id)
    expect(stored?.topics.sort()).toEqual(['memory', 'ritual'])
  })
})

describe('searchDispatches', () => {
  it('6. searches title, topics, and body, published-only', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'title-match', title: 'A quiet morning ritual' }),
        row({ id: 'body-match', body: 'Something about a quiet street.' }),
        row({ id: 'topic-match', title: 'Unrelated' }),
        row({ id: 'unpublished-match', title: 'quiet but unpublished', status: 'unpublished' }),
      ],
      topics: [{ dispatch_id: 'topic-match', topic: 'quiet mornings' }],
    })
    const result = await searchDispatches(client(fake), 'quiet')
    expect(result.map((r) => r.id).sort()).toEqual(['body-match', 'title-match', 'topic-match'])
  })

  it('an empty query returns nothing rather than the whole Board', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [row()] })
    expect(await searchDispatches(client(fake), '   ')).toHaveLength(0)
  })
})

describe('dispatchTitleError', () => {
  it('rejects a blank title', () => {
    expect(dispatchTitleError('   ')).toBe('A Dispatch needs a title.')
  })

  it('rejects a title over 70 characters', () => {
    expect(dispatchTitleError('x'.repeat(71))).toBe('Title is too long.')
  })

  it('accepts a title at exactly 70 characters', () => {
    expect(dispatchTitleError('x'.repeat(70))).toBeNull()
  })

  it('accepts an ordinary one-line title', () => {
    expect(dispatchTitleError('What is this about, in one line?')).toBeNull()
  })
})

describe('normalizeTopics', () => {
  it('4. caps at 3 topics', () => {
    expect(normalizeTopics(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c'])
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeTopics(['  ritual  '])).toEqual(['ritual'])
  })

  it('rejects blank tags', () => {
    expect(normalizeTopics(['ritual', '   ', ''])).toEqual(['ritual'])
  })

  it('deduplicates case-insensitively, keeping the first casing seen', () => {
    expect(normalizeTopics(['Ritual', 'ritual', 'RITUAL'])).toEqual(['Ritual'])
  })

  it('clips an abusively long tag rather than accepting it whole', () => {
    const long = 'x'.repeat(100)
    expect(normalizeTopics([long])[0]).toHaveLength(40)
  })
})

describe('dispatchExcerpt / dispatchIsRich', () => {
  it('5. the excerpt never leaks the invisible rich-body marker itself', () => {
    const rich = docToPlainBody({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quiet morning.', marks: [{ type: 'bold' }] }] }],
    })
    expect(rich.startsWith(RICH_BODY_MARKER)).toBe(true)
    const excerpt = dispatchExcerpt(rich)
    expect(excerpt.includes(RICH_BODY_MARKER)).toBe(false)
    expect(excerpt).toBe('**A quiet morning.**')
  })

  it('a plain body is never mistakenly treated as formatted', () => {
    expect(dispatchIsRich('I *really* mean it, and my_username is unrelated.')).toBe(false)
  })
})

describe('sortBoardDispatches — Board ordering', () => {
  function item(id: string, opts: { seen?: boolean; kept?: boolean; authorId?: string; publishedAt?: string }) {
    return {
      id,
      seen: opts.seen ?? false,
      kept: opts.kept ?? false,
      authorId: opts.authorId ?? AUTHOR_A,
      publishedAt: opts.publishedAt ?? '2026-09-07T00:00:00Z',
    }
  }

  it('7/9. unseen-kept, then unseen-others, then seen — never a popularity signal', () => {
    const seenItem = item('seen', { seen: true, publishedAt: '2026-09-07T05:00:00Z' })
    const unseenOther = item('unseen-other', { publishedAt: '2026-09-07T01:00:00Z' })
    const unseenKept = item('unseen-kept', { kept: true, publishedAt: '2026-09-07T00:00:00Z' })

    const result = sortBoardDispatches([seenItem, unseenOther, unseenKept])
    expect(result.map((r) => r.id)).toEqual(['unseen-kept', 'unseen-other', 'seen'])
  })

  it('newest first within each tier', () => {
    const older = item('older', { publishedAt: '2026-09-07T00:00:00Z' })
    const newer = item('newer', { publishedAt: '2026-09-07T02:00:00Z' })
    const result = sortBoardDispatches([older, newer])
    expect(result.map((r) => r.id)).toEqual(['newer', 'older'])
  })

  it('9. author diversity — one prolific kept writer never occupies the entire unseen-kept tier consecutively', () => {
    const prolific = ['p1', 'p2', 'p3'].map((id, i) =>
      item(id, { kept: true, authorId: 'prolific', publishedAt: `2026-09-07T0${3 - i}:00:00Z` })
    )
    const other = item('other', { kept: true, authorId: 'other-author', publishedAt: '2026-09-07T00:30:00Z' })
    const result = sortBoardDispatches([...prolific, other])
    // The other kept author's item must not be pushed to the very end
    // merely because the prolific author published more recently overall.
    expect(result.findIndex((r) => r.id === 'other')).toBeLessThan(3)
  })
})

describe('interleaveByAuthor', () => {
  it('round-robins across authors, preserving each author\'s own relative order', () => {
    const items = [
      { authorId: 'a', id: 'a1' },
      { authorId: 'a', id: 'a2' },
      { authorId: 'b', id: 'b1' },
    ]
    expect(interleaveByAuthor(items).map((i) => i.id)).toEqual(['a1', 'b1', 'a2'])
  })

  it('a single author is left in original order', () => {
    const items = [
      { authorId: 'a', id: 'a1' },
      { authorId: 'a', id: 'a2' },
    ]
    expect(interleaveByAuthor(items).map((i) => i.id)).toEqual(['a1', 'a2'])
  })
})

describe('clampReadingPosition', () => {
  it('clamps a stored position past the end back into range', () => {
    expect(clampReadingPosition(99, 5)).toBe(4)
  })

  it('clamps a negative stored position up to 0', () => {
    expect(clampReadingPosition(-3, 5)).toBe(0)
  })

  it('a Dispatch with no paragraphs never produces an invalid index', () => {
    expect(clampReadingPosition(2, 0)).toBe(0)
  })

  it('an in-range position is left untouched', () => {
    expect(clampReadingPosition(2, 5)).toBe(2)
  })
})

describe('Keep in Mind', () => {
  it('8. self-Keep is rejected before any write', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { error } = await keepMind(client(fake), AUTHOR_A, AUTHOR_A)
    expect(error?.message).toContain('cannot Keep yourself')
  })

  it('7. Keep is private — isKeepingMind only ever answers for the querying viewer', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [],
      kept: [{ viewer_user_id: AUTHOR_A, kept_user_id: AUTHOR_B }],
    })
    // AUTHOR_B (the kept person) querying whether THEY keep AUTHOR_A
    // finds nothing — the row above belongs to AUTHOR_A, not them.
    expect(await isKeepingMind(client(fake), AUTHOR_B, AUTHOR_A)).toBe(false)
  })
})

describe('Dispatch sharing — share_dispatch / revoke_dispatch_share', () => {
  it('1/2. shareDispatch calls share_dispatch and returns the server-issued token, never a client-generated one', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const { data, error } = await shareDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
    expect(data?.dispatchId).toBe('d-1')
    expect(data?.id).toMatch(/^share-/)
  })

  it('3. calling shareDispatch again for the same Dispatch reuses the existing active token', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const first = await shareDispatch(client(fake), 'd-1')
    const second = await shareDispatch(client(fake), 'd-1')
    expect(second.data?.id).toBe(first.data?.id)
  })

  it('Board usability checkpoint (2026-09-09): a non-author authenticated member CAN now share — superseding the earlier author-only rule', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const { data, error } = await shareDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
    expect(data?.dispatchId).toBe('d-1')
  })

  it('an unpublished Dispatch cannot be shared', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'unpublished' })],
    })
    const { data, error } = await shareDispatch(client(fake), 'd-1')
    expect(data).toBeNull()
    expect(error?.message).toContain('published')
  })

  it('6. revokeDispatchShare calls revoke_dispatch_share and clears the active share', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    await shareDispatch(client(fake), 'd-1')
    expect(await getActiveDispatchShare(client(fake), 'd-1')).not.toBeNull()

    const { error } = await revokeDispatchShare(client(fake), 'd-1')
    expect(error).toBeNull()
    expect(await getActiveDispatchShare(client(fake), 'd-1')).toBeNull()
  })

  it('20. revoking a share does not touch the Dispatch itself — it remains published and visible on the Board', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
    })
    await shareDispatch(client(fake), 'd-1')
    await revokeDispatchShare(client(fake), 'd-1')

    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).toContain('d-1')
  })

  it('sharing a Dispatch that is already shared again after a revoke produces a fresh token', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const first = await shareDispatch(client(fake), 'd-1')
    await revokeDispatchShare(client(fake), 'd-1')
    const second = await shareDispatch(client(fake), 'd-1')
    expect(second.data?.id).not.toBe(first.data?.id)
  })
})

describe('Dispatch sharing — getSharedDispatch (the external reader\'s sole data path)', () => {
  it('8. a valid, live token returns the full Dispatch: title, body, pseudonym, topics, and resolved Moment URLs', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published', title: 'A quiet morning', body: 'Hello, wider Tempa.' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      topics: [{ dispatch_id: 'd-1', topic: 'mornings' }],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
      moments: [{ id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'author-a/photo.jpg' }],
    })

    const shared = await getSharedDispatch(client(fake), 'token-1')
    expect(shared?.title).toBe('A quiet morning')
    expect(shared?.body).toBe('Hello, wider Tempa.')
    expect(shared?.authorPseudonym).toBe('Evening Quill')
    expect(shared?.topics).toEqual(['mornings'])
    expect(shared?.moments).toEqual([{ id: 'm-1', position: 0, imageUrl: 'https://signed.test/dispatch-photos/author-a/photo.jpg' }])
  })

  it('15. never exposes the raw storage path as its own field — only a resolved imageUrl', async () => {
    // A real signed URL legitimately embeds the object path in cleartext
    // (that's how Supabase's own signing works — only the token part is
    // access-limited), so the guarantee here isn't "the path substring
    // never appears in a URL," it's that the RAW database column
    // (image_path) is never returned as a standalone field a caller
    // could read independent of a resolved, time-limited URL.
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
      moments: [{ id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'author-a/secret-path.jpg' }],
    })
    const shared = await getSharedDispatch(client(fake), 'token-1')
    expect(shared?.moments[0]).toEqual({ id: 'm-1', position: 0, imageUrl: expect.any(String) })
    expect(Object.keys(shared?.moments[0] ?? {})).not.toContain('image_path')
    expect(Object.keys(shared?.moments[0] ?? {})).not.toContain('imagePath')
  })

  it('14. only returns Moments that belong to the shared Dispatch, never another one\'s', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [
        row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' }),
        row({ id: 'd-2', author_id: AUTHOR_A, status: 'published' }),
      ],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
      moments: [
        { id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'a/one.jpg' },
        { id: 'm-2', dispatch_id: 'd-2', position: 0, image_path: 'a/two.jpg' },
      ],
    })
    const shared = await getSharedDispatch(client(fake), 'token-1')
    expect(shared?.moments).toHaveLength(1)
    expect(shared?.moments[0]?.id).toBe('m-1')
  })

  it('9. an invalid token returns null, never an error and never another Dispatch\'s data', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    expect(await getSharedDispatch(client(fake), 'no-such-token')).toBeNull()
  })

  it('9. a revoked token returns null even though the Dispatch is still published', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: '2026-09-08T00:00:00Z' }],
    })
    expect(await getSharedDispatch(client(fake), 'token-1')).toBeNull()
  })

  it('9. a token whose Dispatch is no longer published returns null even though the share row is still live', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'unpublished' })],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
    })
    expect(await getSharedDispatch(client(fake), 'token-1')).toBeNull()
  })

  // Board live-test corrections (2026-09-10), share lifecycle: Share →
  // link A; Stop sharing → A dies PERMANENTLY; Share again → a genuinely
  // new link B, and A must never resurrect.
  it('an old link stays permanently unavailable after stopping sharing and sharing again with a new link', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
    })
    const first = await shareDispatch(client(fake), 'd-1')
    await revokeDispatchShare(client(fake), 'd-1')
    const second = await shareDispatch(client(fake), 'd-1')

    expect(second.data?.id).not.toBe(first.data?.id)
    expect(await getSharedDispatch(client(fake), first.data!.id)).toBeNull()
    expect(await getSharedDispatch(client(fake), second.data!.id)).not.toBeNull()
  })
})

describe('Board usability checkpoint — Home Dispatch set', () => {
  it('never shows more than 3 Dispatches', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'd-1', published_at: '2026-09-08T00:00:00Z' }),
        row({ id: 'd-2', published_at: '2026-09-07T00:00:00Z' }),
        row({ id: 'd-3', published_at: '2026-09-06T00:00:00Z' }),
        row({ id: 'd-4', published_at: '2026-09-05T00:00:00Z' }),
      ],
    })
    const home = await getHomeBoardDispatches(client(fake), VIEWER)
    expect(home).toHaveLength(3)
  })

  it('is unseen-first, same tiering as the Board itself — a seen Dispatch is replaced by an unseen one', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'seen-1', published_at: '2026-09-08T00:00:00Z' }),
        row({ id: 'unseen-1', published_at: '2026-09-01T00:00:00Z' }),
        row({ id: 'unseen-2', published_at: '2026-09-02T00:00:00Z' }),
        row({ id: 'unseen-3', published_at: '2026-09-03T00:00:00Z' }),
      ],
      views: [{ viewer_id: VIEWER, dispatch_id: 'seen-1', last_paragraph_index: 0 }],
    })
    const home = await getHomeBoardDispatches(client(fake), VIEWER)
    expect(home.map((d) => d.id)).not.toContain('seen-1')
    expect(home).toHaveLength(3)
  })
})

describe('Board usability checkpoint — sharing broadened to any authenticated member', () => {
  it('a non-author authenticated member can request a share token for a published Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const { data, error } = await shareDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
    expect(data?.dispatchId).toBe('d-1')
  })

  it('two different members sharing the same Dispatch receive the identical active token', async () => {
    // Two separate fake clients (simulating two separate sessions)
    // sharing the SAME underlying rows/shares arrays by reference — the
    // same way two real sessions share one live database.
    const sharedRows = [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })]
    const sharedShares: { id: string; dispatch_id: string; revoked_at: string | null }[] = []

    const asAuthor = createFakeDispatches({ viewerId: AUTHOR_A, rows: sharedRows, shares: sharedShares })
    const asOtherMember = createFakeDispatches({ viewerId: AUTHOR_B, rows: sharedRows, shares: sharedShares })

    const first = await shareDispatch(client(asAuthor), 'd-1')
    const second = await shareDispatch(client(asOtherMember), 'd-1')
    expect(second.data?.id).toBe(first.data?.id)
  })

  it('only the author may revoke — a non-author calling revoke is rejected', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
    })
    const { error } = await revokeDispatchShare(client(fake), 'd-1')
    expect(error?.message).toContain('author')
  })
})

describe('Board usability checkpoint — updateDispatch (edit)', () => {
  it('the author can edit their own published Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'Old title' })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', {
      title: 'New title',
      body: 'New body.',
      topics: ['fashion'],
    })
    expect(error).toBeNull()
    expect(data?.title).toBe('New title')
    expect(data?.body).toBe('New body.')
  })

  it('a non-author cannot edit', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', { title: 'Hijacked', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toContain('author')
  })

  it('editing preserves the Dispatch id — it is the same row, not a replacement', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { data } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(data?.id).toBe('d-1')
  })

  it('editing does not create a new external share token — an existing active token survives untouched', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const share = await shareDispatch(client(fake), 'd-1')
    await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    const stillActive = await getActiveDispatchShare(client(fake), 'd-1')
    expect(stillActive?.id).toBe(share.data?.id)
  })

  it('a failed edit (blank title) does not destroy the existing Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'Untouched' })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: '  ', body: 'x', topics: [] })
    expect(error).not.toBeNull()

    const stillThere = await getDispatchById(client(fake), 'd-1')
    expect(stillThere?.title).toBe('Untouched')
  })

  it('validation matches publishing: a 71-character title is rejected the same way', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const tooLong = await updateDispatch(client(fake), 'd-1', { title: 'x'.repeat(71), body: 'x', topics: [] })
    expect(tooLong.error?.message).toContain('too long')
  })

  it('validation matches publishing: topics are capped at 3 client-side before the RPC ever sees them (normalizeTopics)', async () => {
    // Same reality as publishDispatch's own topic cap (see
    // normalizeTopics' own "caps at 3 topics" test): updateDispatch
    // pre-normalizes, so the RPC's own >3 check is defense-in-depth for
    // a direct/malicious RPC call, not something reachable through this
    // wrapper — this test proves the wrapper's own contract instead.
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', {
      title: 'Fine',
      body: 'x',
      topics: ['a', 'b', 'c', 'd'],
    })
    expect(error).toBeNull()
    const reloaded = await getDispatchById(client(fake), 'd-1')
    expect(reloaded?.topics).toEqual(['a', 'b', 'c'])
  })
})

describe('Board usability checkpoint — deleteDispatch', () => {
  it('the author can delete their own Dispatch, which then disappears from the Board', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).not.toContain('d-1')
  })

  it('a non-author cannot delete', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error?.message).toContain('author')
    expect(await getDispatchById(client(fake), 'd-1')).not.toBeNull()
  })

  it('deleting a Dispatch makes its external share link unavailable', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const share = await shareDispatch(client(fake), 'd-1')
    await deleteDispatch(client(fake), 'd-1')
    expect(await getSharedDispatch(client(fake), share.data!.id)).toBeNull()
  })
})

describe('Board usability checkpoint — pin to profile', () => {
  it('pinning a published Dispatch is reflected by getPinnedDispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'My pinned piece' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill', pinned_dispatch_id: null }],
    })
    expect(await getPinnedDispatch(client(fake), AUTHOR_A)).toBeNull()

    await pinDispatch(client(fake), 'd-1')
    const pinned = await getPinnedDispatch(client(fake), AUTHOR_A)
    expect(pinned?.id).toBe('d-1')
  })

  it('pinning a different Dispatch atomically replaces the previous pin — never more than one', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A }), row({ id: 'd-2', author_id: AUTHOR_A })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill', pinned_dispatch_id: null }],
    })
    await pinDispatch(client(fake), 'd-1')
    await pinDispatch(client(fake), 'd-2')
    const pinned = await getPinnedDispatch(client(fake), AUTHOR_A)
    expect(pinned?.id).toBe('d-2')
  })

  it('unpinning clears it', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill', pinned_dispatch_id: 'd-1' }],
    })
    await unpinDispatch(client(fake))
    expect(await getPinnedDispatch(client(fake), AUTHOR_A)).toBeNull()
  })

  it('a member cannot pin someone else\'s Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      profiles: [{ id: AUTHOR_B, pseudonym: 'Other Member', pinned_dispatch_id: null }],
    })
    const { error } = await pinDispatch(client(fake), 'd-1')
    expect(error?.message).toContain('author')
  })
})

// ============================================================
// SAFETY & TRUST CHECKPOINT 1B — client-level behavior that this
// harness CAN exercise: the fake mirrors block_user/keep_mind's
// documented server-side contract (docs/sql/2026-09-11-safety-
// blocking-foundation.sql) structurally, the same way it already
// mirrors dispatches_select_published. This does NOT verify the actual
// live Postgres RLS/RPC behavior — that migration is prepared but not
// executed, and this codebase's own convention has always been that
// SQL correctness is verified via the migration's own read-only
// verification script plus live testing after execution, never via
// mocks that don't touch a real database. What IS meaningfully proven
// here: lib/dispatches.ts's keepMind/unkeepMind now call the RPCs
// (keep_mind/unkeep_mind) rather than writing kept_minds directly, and
// the documented cascade/exclusion CONTRACT is exercised end-to-end
// against a fake that encodes that same contract.
// ============================================================

describe('Safety & Trust Checkpoint 1B — Keep conversion to RPC-only', () => {
  it('keepMind now calls keep_mind (not a direct table insert) and succeeds for an unblocked pair', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { error } = await keepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).toBeNull()
  })

  it('a duplicate Keep is a silent success (keep_mind is idempotent), not a 23505 the caller must special-case', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
    })
    await keepMind(client(fake), VIEWER, AUTHOR_A)
    const { error } = await keepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).toBeNull()
  })

  it('keep_mind rejects a blocked pair', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const { error } = await keepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).not.toBeNull()
    // Neutral wording — never names blocking as the reason.
    expect(error?.message.toLowerCase()).not.toContain('block')
  })

  it('keep_mind rejects a blocked pair regardless of which direction the block was recorded', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      blocked: [{ blocker_id: AUTHOR_A, blocked_id: VIEWER }],
    })
    const { error } = await keepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).not.toBeNull()
  })

  it('unkeepMind (de-escalating) remains available even for a blocked pair', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const { error } = await unkeepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).toBeNull()
  })
})

describe('Safety & Trust Checkpoint 1B — block_user Keep cascade', () => {
  it('blocking removes an existing Keep in the blocker-to-blocked direction', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A)
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
  })

  it('blocking removes an existing Keep in the OTHER direction too (the blocked party had kept the blocker)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: AUTHOR_A, kept_user_id: VIEWER }],
    })
    await blockUser(client(fake), AUTHOR_A)
    expect(await isKeepingMind(client(fake), AUTHOR_A, VIEWER)).toBe(false)
  })

  it('unblocking does not restore a Keep relationship removed by the block', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A)
    await unblockUser(client(fake), AUTHOR_A)
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
  })

  it('cannot block yourself', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const { error } = await blockUser(client(fake), VIEWER)
    expect(error).not.toBeNull()
  })
})

describe('Safety & Trust Checkpoint 1B — Dispatch visibility mirrors the documented block-aware RLS contract', () => {
  it('a blocked author\'s published Dispatch is excluded from the viewer\'s Board pool', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).not.toContain('d-1')
  })

  it('an unrelated (non-blocked) author\'s Dispatch remains visible', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' }),
        row({ id: 'd-2', author_id: AUTHOR_B, status: 'published' }),
      ],
      profiles: [
        { id: AUTHOR_A, pseudonym: 'Evening Quill' },
        { id: AUTHOR_B, pseudonym: 'Other Member' },
      ],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).toContain('d-2')
  })

  it('an author retains access to their OWN Dispatch even against a viewer who blocked them', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    expect(await getDispatchById(client(fake), 'd-1')).not.toBeNull()
  })
})

// Checkpoint 1C — scoped blocking (docs/sql/2026-09-12-scoped-blocking-
// and-fixes.sql). A 'letters' block is deliberately invisible to every
// surface gated by is_blocked_pair (now redefined as FULL-only): public
// Dispatch/Board visibility and Keep in Mind. Only a 'full' block (or a
// letters block upgraded to full) trips these.
describe('Checkpoint 1C — a letters-only block leaves public Dispatch visibility and Keep untouched', () => {
  it('A. a letters-only block does NOT hide the blocked author\'s published Dispatch from the Board', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).toContain('d-1')
  })

  it('A. a letters-only block does NOT remove an existing Keep relationship', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A, 'letters')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(true)
  })

  it('A. keepMind still succeeds for a pair with only a letters-only block between them', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { error } = await keepMind(client(fake), VIEWER, AUTHOR_A)
    expect(error).toBeNull()
  })

  it('B. a full block still hides the blocked author\'s Dispatch and removes Keep (unchanged behavior)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A, 'full')
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).not.toContain('d-1')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
  })

  it('C. upgrading an existing letters-only block to full removes Keep at the moment of upgrade', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A, 'letters')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(true)
    await blockUser(client(fake), AUTHOR_A, 'full')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).not.toContain('d-1')
  })

  it('D. downgrading a full block to letters-only never restores the Keep the full block removed', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), AUTHOR_A, 'full')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
    await blockUser(client(fake), AUTHOR_A, 'letters')
    expect(await isKeepingMind(client(fake), VIEWER, AUTHOR_A)).toBe(false)
  })

  it('D. unblocking a letters-only block removes it the same as unblocking a full block', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), AUTHOR_A, 'letters')
    const { error } = await unblockUser(client(fake), AUTHOR_A)
    expect(error).toBeNull()
  })
})
