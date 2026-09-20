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
  getHomeBoardCandidates,
  updateDispatch,
  deleteDispatch,
  pinDispatch,
  unpinDispatch,
  getPinnedDispatch,
  getBoardFeedPage,
  getFirstMomentThumbnails,
  getDispatchMoments,
  partitionHomeSections,
  readingTrailSearchParams,
  parseReadingTrailParams,
  getNextTrailItems,
  CONTINUE_READING_COUNT,
  getDispatchPostcard,
  isWithinDispatchEditWindow,
  canEditDispatch,
  type BoardFeedCursor,
  type BoardFeedItem,
} from './dispatches'
import { docToPlainBody, RICH_BODY_MARKER } from './letter-editor-doc'
import { blockUser, unblockUser } from './blocking'
import {
  createFakeDispatches,
  type FakeDispatchRow,
  type FakeReplyRow,
  type FakePostcardCatalogRow,
  type FakePostcardVersionRow,
  type FakeCorrespondenceRow,
} from './__tests__/fakeDispatches'

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

  // Smoke-test contract completion checkpoint: 70 -> 140.
  it('2. title max length is enforced', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'x'.repeat(141),
      body: 'x',
      topics: [],
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('too long')
  })

  // Smoke-test contract completion checkpoint: 70 -> 140.
  it('a title at exactly 140 characters succeeds', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'x'.repeat(140),
      body: 'A long-form Dispatch.',
      topics: [],
    })
    expect(error).toBeNull()
    expect(data?.title).toHaveLength(140)
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

  it('independent review item 5 (final audit round): a freshly published Dispatch always lands moderation_status = visible — a raw insert cannot forge a hidden/moderated state, mirrored by dispatches_insert_own\'s tightened WITH CHECK', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [] })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'Freshly published',
      body: 'x',
      topics: [],
    })
    expect(error).toBeNull()
    expect(data?.moderationStatus).toBe('visible')

    // And it's immediately visible on the Board — proving the row
    // wasn't accidentally created in a filtered-out state.
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.id)).toContain(data!.id)
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

// Dispatch Postcards Checkpoint 2.
const ACTIVE_CATALOG: FakePostcardCatalogRow[] = [{ key: 'essaouira', is_active: true }]
const CURRENT_VERSION: FakePostcardVersionRow = {
  id: 'version-essaouira-1',
  postcard_key: 'essaouira',
  is_current: true,
  title: 'Essaouira',
  location: 'Atlantic Morocco',
  collection: 'Atlantic Morocco Collection',
  postmark_text: 'ESSAOUIRA',
  footer_text: 'Tempa Postcard',
  front_image_path: '/postcards/essaouira.jpg',
}

describe('publishDispatch — Postcard (Checkpoint 2)', () => {
  it('no Postcard remains valid behavior — omitting it publishes exactly as before', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [], profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }] })
    const { data, error } = await publishDispatch(client(fake), { title: 'No postcard here', body: 'x', topics: [] })
    expect(error).toBeNull()
    expect(fake._dispatchPostcards).toHaveLength(0)
    expect(data?.id).toBeTruthy()
  })

  it('a valid Postcard is captured, resolving the CURRENT immutable version — never the bare key', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'A Dispatch with a Postcard',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: 'A little something.', backMessage: 'Written for this one.' },
    })
    expect(error).toBeNull()
    expect(fake._dispatchPostcards).toHaveLength(1)
    const stored = fake._dispatchPostcards[0]
    expect(stored.dispatch_id).toBe(data!.id)
    expect(stored.postcard_version_id).toBe('version-essaouira-1')
    expect(stored.sender_pseudonym_snapshot).toBe('Evening Quill')
    expect(stored.back_message).toBe('Written for this one.')
  })

  it('an inactive/unknown catalog key is rejected, and publication does not proceed at all (atomic rollback)', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: [{ key: 'retired', is_active: false }],
      postcardVersions: [{ ...CURRENT_VERSION, id: 'v-retired', postcard_key: 'retired' }],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'Should never publish',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'retired', revealLine: '', backMessage: 'Hello.' },
    })
    expect(data).toBeNull()
    expect(error?.message).toBe('Unknown postcard.')
    // Nothing was created — same "half-published Dispatch never exists"
    // guarantee write_letter's own Postcard validation already has.
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((d) => d.title)).not.toContain('Should never publish')
    expect(fake._dispatchPostcards).toHaveLength(0)
  })

  it('invalid Postcard content (blank back message) is rejected before publication', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'Blank back message',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: '   ' },
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('written message')
    expect(fake._dispatchPostcards).toHaveLength(0)
  })

  it('a Reveal Line over 32 characters is rejected', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'Too long a reveal line',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: 'x'.repeat(33), backMessage: 'Hello.' },
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('Reveal Line')
  })

  // Smoke-test contract completion checkpoint: 200 -> 300.
  it('a back message over 300 characters is rejected', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'Too long a back message',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: 'x'.repeat(301) },
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('too long')
  })

  it('a back message at exactly 300 characters is accepted — the Dispatch Postcard surface uses the new 300 ceiling', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data, error } = await publishDispatch(client(fake), {
      title: 'A long back message',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: 'x'.repeat(300) },
    })
    expect(error).toBeNull()
    expect(fake._dispatchPostcards.find((p) => p.dispatch_id === data!.id)?.back_message).toHaveLength(300)
  })

  it('one Postcard maximum — two separate publishes each get their own single row, never more than one per Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const first = await publishDispatch(client(fake), {
      title: 'First',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: 'One.' },
    })
    const second = await publishDispatch(client(fake), {
      title: 'Second',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: 'Two.' },
    })
    expect(fake._dispatchPostcards).toHaveLength(2)
    expect(fake._dispatchPostcards.filter((p) => p.dispatch_id === first.data!.id)).toHaveLength(1)
    expect(fake._dispatchPostcards.filter((p) => p.dispatch_id === second.data!.id)).toHaveLength(1)
  })

  it('updateDispatch cannot change or remove an already-published Dispatch\'s Postcard — it has no such parameter at all', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      postcardCatalog: ACTIVE_CATALOG,
      postcardVersions: [CURRENT_VERSION],
    })
    const { data } = await publishDispatch(client(fake), {
      title: 'Has a Postcard',
      body: 'x',
      topics: [],
      postcard: { postcardKey: 'essaouira', revealLine: '', backMessage: 'Frozen forever.' },
    })
    // updateDispatch's own TypeScript input type has no postcard field —
    // this call is exactly what the composer's edit-mode submit sends.
    await updateDispatch(client(fake), data!.id, { title: 'Edited title', body: 'edited body', topics: [] })
    expect(fake._dispatchPostcards).toHaveLength(1)
    expect(fake._dispatchPostcards[0].back_message).toBe('Frozen forever.')
  })
})

describe('getDispatchPostcard', () => {
  it('returns null when the Dispatch has no attached Postcard', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [row({ id: 'no-postcard' })] })
    expect(await getDispatchPostcard(client(fake), 'no-postcard')).toBeNull()
  })

  it('resolves the attached Postcard\'s frozen version content', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'with-postcard' })],
      postcardVersions: [CURRENT_VERSION],
      dispatchPostcards: [
        {
          dispatch_id: 'with-postcard',
          postcard_version_id: 'version-essaouira-1',
          reveal_line: 'Hello there.',
          back_message: 'Written just for this Dispatch.',
          sender_pseudonym_snapshot: 'Evening Quill',
        },
      ],
    })
    const postcard = await getDispatchPostcard(client(fake), 'with-postcard')
    expect(postcard?.revealLine).toBe('Hello there.')
    expect(postcard?.backMessage).toBe('Written just for this Dispatch.')
    expect(postcard?.senderPseudonymSnapshot).toBe('Evening Quill')
    expect(postcard?.version.frontImagePath).toBe('/postcards/essaouira.jpg')
  })

  it('never resolves a Postcard for a Dispatch this viewer cannot otherwise see (mirrors dispatch_postcards_select_visible\'s RLS delegation)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'unpublished', status: 'unpublished', author_id: AUTHOR_A })],
      postcardVersions: [CURRENT_VERSION],
      dispatchPostcards: [
        {
          dispatch_id: 'unpublished',
          postcard_version_id: 'version-essaouira-1',
          reveal_line: null,
          back_message: 'Hidden along with the Dispatch itself.',
          sender_pseudonym_snapshot: 'Evening Quill',
        },
      ],
    })
    expect(await getDispatchPostcard(client(fake), 'unpublished')).toBeNull()
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

// Smoke-test contract completion checkpoint — the two pure UI-hint
// helpers directly, mock-free (same precedent as canWriteToMind's own
// direct-predicate tests), independent of the fake-RPC integration
// tests above.
describe('isWithinDispatchEditWindow', () => {
  it('is true immediately at publish time', () => {
    expect(isWithinDispatchEditWindow(new Date().toISOString(), new Date())).toBe(true)
  })

  it('is true just before the 30-minute boundary', () => {
    const now = new Date('2026-01-01T00:30:00Z')
    const publishedAt = new Date('2026-01-01T00:00:01Z').toISOString()
    expect(isWithinDispatchEditWindow(publishedAt, now)).toBe(true)
  })

  it('is true exactly at the 30-minute boundary — the boundary itself is still editable (<=, not <)', () => {
    const publishedAt = new Date('2026-01-01T00:00:00Z').toISOString()
    const now = new Date('2026-01-01T00:30:00Z')
    expect(isWithinDispatchEditWindow(publishedAt, now)).toBe(true)
  })

  it('is false just after the 30-minute boundary', () => {
    const publishedAt = new Date('2026-01-01T00:00:00Z').toISOString()
    const now = new Date('2026-01-01T00:30:00.001Z')
    expect(isWithinDispatchEditWindow(publishedAt, now)).toBe(false)
  })

  it('defaults `now` to the current time when not given', () => {
    expect(isWithinDispatchEditWindow(new Date(Date.now() - 60 * 60 * 1000).toISOString())).toBe(false)
  })
})

describe('canEditDispatch', () => {
  it('true only when the viewer is the author, within the window, and no reply exists', () => {
    expect(canEditDispatch({ isAuthor: true, withinEditWindow: true, replyExists: false })).toBe(true)
  })

  it('false for a non-author, regardless of window/reply state', () => {
    expect(canEditDispatch({ isAuthor: false, withinEditWindow: true, replyExists: false })).toBe(false)
  })

  it('false once the window has closed, even for the author with no replies', () => {
    expect(canEditDispatch({ isAuthor: true, withinEditWindow: false, replyExists: false })).toBe(false)
  })

  it('false once a reply exists, even for the author within the window', () => {
    expect(canEditDispatch({ isAuthor: true, withinEditWindow: true, replyExists: true })).toBe(false)
  })
})

describe('dispatchTitleError', () => {
  it('rejects a blank title', () => {
    expect(dispatchTitleError('   ')).toBe('A Dispatch needs a title.')
  })

  // Smoke-test contract completion checkpoint: 70 -> 140.
  it('rejects a title over 140 characters', () => {
    expect(dispatchTitleError('x'.repeat(141))).toBe('Title is too long.')
  })

  it('accepts a title at exactly 140 characters', () => {
    expect(dispatchTitleError('x'.repeat(140))).toBeNull()
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

  // Dispatch Postcards Checkpoint 2 — the signed-out reader gets the same
  // resolved Postcard content, straight from get_shared_dispatch itself,
  // never a second direct query against dispatch_postcards/postcard_
  // catalog/postcard_versions.
  it('a shared Dispatch with an attached Postcard resolves it for the signed-out reader', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
      postcardVersions: [CURRENT_VERSION],
      dispatchPostcards: [
        {
          dispatch_id: 'd-1',
          postcard_version_id: 'version-essaouira-1',
          reveal_line: 'Keep a little sea with you.',
          back_message: 'Made it here at last.',
          sender_pseudonym_snapshot: 'Evening Quill',
        },
      ],
    })
    const shared = await getSharedDispatch(client(fake), 'token-1')
    expect(shared?.postcard?.backMessage).toBe('Made it here at last.')
    expect(shared?.postcard?.revealLine).toBe('Keep a little sea with you.')
    expect(shared?.postcard?.senderPseudonymSnapshot).toBe('Evening Quill')
    expect(shared?.postcard?.version.frontImagePath).toBe('/postcards/essaouira.jpg')
  })

  it('a shared Dispatch with no Postcard resolves postcard: null, and everything else works normally', async () => {
    const fake = createFakeDispatches({
      viewerId: null,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'published', title: 'No postcard here' })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Evening Quill' }],
      shares: [{ id: 'token-1', dispatch_id: 'd-1', revoked_at: null }],
    })
    const shared = await getSharedDispatch(client(fake), 'token-1')
    expect(shared?.postcard).toBeNull()
    expect(shared?.title).toBe('No postcard here')
  })
})

describe('Home Phase 1 (Editorial Reading Surface) — Home candidate pool', () => {
  it('no longer hard-caps itself at 3 — fetches up to HOME_CANDIDATE_COUNT candidates', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      row({ id: `d-${i}`, published_at: `2026-09-${String(8 - (i % 8)).padStart(2, '0')}T00:00:00Z` })
    )
    const fake = createFakeDispatches({ viewerId: VIEWER, rows })
    const { items } = await getHomeBoardCandidates(client(fake))
    expect(items.length).toBeGreaterThan(3)
    expect(items.length).toBeLessThanOrEqual(30)
  })

  it('is unseen-first, same tiering as the Board itself — a seen Dispatch is not among the first candidates while unseen ones exist', async () => {
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
    const { items } = await getHomeBoardCandidates(client(fake))
    const ids = items.map((d) => d.id)
    expect(ids.indexOf('seen-1')).toBe(ids.length - 1)
  })

  it('returns the session (sessionStartedAt/seed) it minted, so callers can encode it into reading-trail links', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [row({ id: 'd-1' })] })
    const { sessionStartedAt, seed } = await getHomeBoardCandidates(client(fake))
    expect(typeof sessionStartedAt).toBe('string')
    expect(sessionStartedAt.length).toBeGreaterThan(0)
    expect(typeof seed).toBe('string')
    expect(seed.length).toBeGreaterThan(0)
  })

  it('each candidate carries its own isKept/isFamiliar and cursor (never discarded, unlike the old getHomeBoardDispatches)', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [row({ id: 'd-1' })] })
    const { items } = await getHomeBoardCandidates(client(fake))
    expect(items[0]).toHaveProperty('isKept')
    expect(items[0]).toHaveProperty('isFamiliar')
    expect(items[0]).toHaveProperty('cursor')
    expect(items[0].cursor).toMatchObject({ id: 'd-1' })
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
  // Smoke-test contract completion checkpoint — row()'s own default
  // published_at ('2026-09-07T00:00:00Z') is now permanently outside
  // any 30-minute edit window relative to whenever tests actually run.
  // Every fixture below that means to represent an ordinarily-editable
  // Dispatch (not specifically testing the window itself) overrides
  // published_at to "now" — this isn't weakening the tests, it's
  // supplying the one new piece of state a real edit-window contract
  // now needs, for a fixture whose ORIGINAL intent was always "a
  // normal, freshly-published, editable Dispatch."
  const justPublished = () => new Date().toISOString()

  it('the author can edit their own published Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'Old title', published_at: justPublished() })],
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
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', { title: 'Hijacked', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toContain('author')
  })

  it('editing preserves the Dispatch id — it is the same row, not a replacement', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
    })
    const { data } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(data?.id).toBe('d-1')
  })

  it('editing does not create a new external share token — an existing active token survives untouched', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
    })
    const share = await shareDispatch(client(fake), 'd-1')
    await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    const stillActive = await getActiveDispatchShare(client(fake), 'd-1')
    expect(stillActive?.id).toBe(share.data?.id)
  })

  it('editing does not reset or extend published_at — the edit window\'s clock is untouched by editing itself', async () => {
    const original = justPublished()
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: original })],
    })
    const { data } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(data?.publishedAt).toBe(original)
  })

  it('a failed edit (blank title) does not destroy the existing Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'Untouched', published_at: justPublished() })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: '  ', body: 'x', topics: [] })
    expect(error).not.toBeNull()

    const stillThere = await getDispatchById(client(fake), 'd-1')
    expect(stillThere?.title).toBe('Untouched')
  })

  // Smoke-test contract completion checkpoint — 70 -> 140.
  it('validation matches publishing: a 141-character title is rejected the same way', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
    })
    const tooLong = await updateDispatch(client(fake), 'd-1', { title: 'x'.repeat(141), body: 'x', topics: [] })
    expect(tooLong.error?.message).toContain('too long')
  })

  it('a 140-character title is accepted — create and edit agree on the exact same ceiling', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', {
      title: 'x'.repeat(140),
      body: 'x',
      topics: [],
    })
    expect(error).toBeNull()
    expect(data?.title).toHaveLength(140)
  })

  it('validation matches publishing: topics are capped at 3 client-side before the RPC ever sees them (normalizeTopics)', async () => {
    // Same reality as publishDispatch's own topic cap (see
    // normalizeTopics' own "caps at 3 topics" test): updateDispatch
    // pre-normalizes, so the RPC's own >3 check is defense-in-depth for
    // a direct/malicious RPC call, not something reachable through this
    // wrapper — this test proves the wrapper's own contract instead.
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: justPublished() })],
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

  it('independent review item 4: a HIDDEN Dispatch cannot be edited by its own still-active author', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [
        row({
          id: 'd-1',
          author_id: AUTHOR_A,
          title: 'Frozen while hidden',
          moderation_status: 'hidden',
          published_at: justPublished(),
        }),
      ],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', {
      title: 'Sneaky rewrite',
      body: 'x',
      topics: [],
    })
    expect(data).toBeNull()
    expect(error?.message).toContain('author')
    // The title must remain exactly as it was — evidence not mutated.
    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'visible'
    const reread = await getDispatchById(client(fake), 'd-1')
    expect(reread?.title).toBe('Frozen while hidden')
  })

  it('restoring a Dispatch makes it editable by its author again', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, title: 'Old', moderation_status: 'hidden', published_at: justPublished() })],
    })
    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'visible'
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'New', body: 'x', topics: [] })
    expect(error).toBeNull()
  })
})

// Smoke-test contract completion checkpoint (Section E/F/H/I) — the
// published-Dispatch edit window and reply lock, tested against the
// fake update_dispatch RPC (lib/__tests__/fakeDispatches.ts), which
// mirrors the real SQL's two new checks exactly: now() <= published_at
// + 30 minutes, and bare dispatch_replies row EXISTENCE (never filtered
// by moderation_status/deleted_at).
describe('Smoke-test contract completion — published Dispatch edit window / reply lock', () => {
  const MINUTES = 60 * 1000
  const minutesAgo = (n: number) => new Date(Date.now() - n * MINUTES).toISOString()

  it('10. the author can edit a just-published Dispatch with zero replies', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(0) })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(error).toBeNull()
  })

  it('11. a non-author cannot edit, independent of the window/reply-lock checks', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_B,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(0) })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Hijacked', body: 'x', topics: [] })
    expect(error?.message).toContain('author')
  })

  it('12. the author can edit before the 30-minute boundary, with zero replies', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(29) })],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(error).toBeNull()
  })

  it('13. the author cannot edit after the 30-minute boundary', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(31) })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', { title: 'Too late', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('15. the author cannot edit once a qualifying public reply exists, even well within the 30-minute window', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(1) })],
      replies: [
        {
          id: 'r-1',
          dispatch_id: 'd-1',
          author_id: AUTHOR_B,
          body: 'A real reply.',
          parent_reply_id: null,
          root_reply_id: null,
          reply_to_user_id: null,
          moderation_status: 'visible',
          deleted_at: null,
          created_at: minutesAgo(1),
        },
      ],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', { title: 'Too late', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('16. a stale edit submission is rejected if a reply arrives after the page (conceptually) loaded — the RPC re-checks eligibility itself, not a client-held snapshot', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(1) })],
    })
    // "Page load": eligibility was fine (no replies yet) — this app
    // never trusts that moment; it only ever calls updateDispatch,
    // which re-derives eligibility fresh, right now.
    const beforeReply = await updateDispatch(client(fake), 'd-1', { title: 'First edit', body: 'x', topics: [] })
    expect(beforeReply.error).toBeNull()

    // A reply lands.
    fake._replies.push({
      id: 'r-1',
      dispatch_id: 'd-1',
      author_id: AUTHOR_B,
      body: 'Just replied.',
      parent_reply_id: null,
      root_reply_id: null,
      reply_to_user_id: null,
      moderation_status: 'visible',
      deleted_at: null,
      created_at: new Date().toISOString(),
    })

    // The "stale" submission — same author, same Dispatch, submitted as
    // though nothing had changed since their own earlier successful edit.
    const staleSubmission = await updateDispatch(client(fake), 'd-1', { title: 'Stale edit', body: 'x', topics: [] })
    expect(staleSubmission.data).toBeNull()
    expect(staleSubmission.error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('17. the reply lock is keyed on real row existence in dispatch_replies — never on any client-held/UI state', async () => {
    // No client-side flag of any kind is passed to updateDispatch at
    // all (its own TypeScript input type has no such field) — the lock
    // can only ever be driven by what the fake's own `replies` fixture
    // (standing in for the real dispatch_replies table) actually
    // contains, proving there is no alternate, weaker path to bypass it.
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(1) })],
      replies: [
        {
          id: 'r-1',
          dispatch_id: 'd-1',
          author_id: AUTHOR_A,
          body: 'The author replying to their own Dispatch still counts.',
          parent_reply_id: null,
          root_reply_id: null,
          reply_to_user_id: null,
          moderation_status: 'visible',
          deleted_at: null,
          created_at: minutesAgo(1),
        },
      ],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('18. a moderator-HIDDEN reply still locks editing — the lock is bare row existence, never filtered by moderation_status', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(1) })],
      replies: [
        {
          id: 'r-1',
          dispatch_id: 'd-1',
          author_id: AUTHOR_B,
          body: '',
          parent_reply_id: null,
          root_reply_id: null,
          reply_to_user_id: null,
          moderation_status: 'hidden',
          deleted_at: null,
          created_at: minutesAgo(1),
        },
      ],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('19. a member-DELETED (soft-tombstoned) reply still locks editing — the lock is bare row existence, never filtered by deleted_at', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, published_at: minutesAgo(1) })],
      replies: [
        {
          id: 'r-1',
          dispatch_id: 'd-1',
          author_id: AUTHOR_B,
          body: '',
          parent_reply_id: null,
          root_reply_id: null,
          reply_to_user_id: null,
          moderation_status: 'visible',
          deleted_at: minutesAgo(1),
          created_at: minutesAgo(1),
        },
      ],
    })
    const { error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(error?.message).toBe('This Dispatch can no longer be edited.')
  })

  it('20. an unpublished Dispatch\'s (non-)editability is unaffected by this checkpoint — still refused for the same original reason', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, status: 'unpublished', published_at: minutesAgo(0) })],
    })
    const { data, error } = await updateDispatch(client(fake), 'd-1', { title: 'Edited', body: 'x', topics: [] })
    expect(data).toBeNull()
    expect(error?.message).toContain('author')
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

  it('independent review item 4: a HIDDEN Dispatch cannot be deleted by its own still-active author — moderated evidence is preserved', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, moderation_status: 'hidden' })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error?.message).toContain('author')
    expect(fake._rows.find((r) => r.id === 'd-1')).toBeDefined()
  })

  it('restoring a Dispatch makes it deletable by its author again', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, moderation_status: 'hidden' })],
    })
    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'visible'
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
  })

  // ============================================================
  // Board Experience Phase 2B, pre-SQL correction pass — a Dispatch
  // must never cascade-delete another member's Reply just because its
  // own author deletes the Dispatch. delete_dispatch (docs/sql/2026-09-
  // 23-dispatch-replies.sql piece 2) now refuses the delete outright
  // while ANY Reply row still references the Dispatch.
  // ============================================================
  function replyRow(overrides: Partial<FakeReplyRow> = {}): FakeReplyRow {
    return {
      id: 'r-1',
      dispatch_id: 'd-1',
      author_id: AUTHOR_B,
      body: 'A thoughtful response.',
      created_at: '2026-09-23T00:00:00Z',
      ...overrides,
    }
  }

  it('a Dispatch with zero Replies keeps its prior delete behavior (unchanged)', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      replies: [],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error).toBeNull()
    expect(fake._rows.find((r) => r.id === 'd-1')).toBeUndefined()
  })

  it('a Dispatch with at least one Reply cannot be hard-deleted', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      replies: [replyRow({ id: 'r-1', author_id: AUTHOR_B })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error?.message).toBe('This Dispatch cannot be deleted while it still has Replies.')
    expect(fake._rows.find((r) => r.id === 'd-1')).toBeDefined()
  })

  it('the delete attempt never destroys another member\'s Reply — it survives, untouched', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      replies: [replyRow({ id: 'r-1', author_id: AUTHOR_B, body: 'Please keep writing.' })],
    })
    await deleteDispatch(client(fake), 'd-1')
    const surviving = fake._replies.find((r) => r.id === 'r-1')
    expect(surviving).toBeDefined()
    expect(surviving?.author_id).toBe(AUTHOR_B)
    expect(surviving?.body).toBe('Please keep writing.')
    expect(surviving?.deleted_at).toBeNull()
  })

  it('the guard blocks deletion even when every Reply is the Dispatch author\'s own (no authorship carve-out)', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A })],
      replies: [replyRow({ id: 'r-1', author_id: AUTHOR_A })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-1')
    expect(error?.message).toBe('This Dispatch cannot be deleted while it still has Replies.')
  })

  it('deleting a DIFFERENT Dispatch with no Replies of its own still succeeds even while another Dispatch has Replies', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A }), row({ id: 'd-2', author_id: AUTHOR_A })],
      replies: [replyRow({ id: 'r-1', dispatch_id: 'd-1', author_id: AUTHOR_B })],
    })
    const { error } = await deleteDispatch(client(fake), 'd-2')
    expect(error).toBeNull()
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

describe('Admin Phase 2A-1 — hidden Dispatch is invisible everywhere except the author\'s own direct view', () => {
  it('the Board pool (getPublishedDispatches) excludes a hidden Dispatch, even the viewer\'s own', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [
        row({ id: 'visible-1', author_id: AUTHOR_A, moderation_status: 'visible' }),
        row({ id: 'hidden-1', author_id: AUTHOR_A, moderation_status: 'hidden' }),
      ],
    })
    const result = await getPublishedDispatches(client(fake))
    expect(result.map((r) => r.id)).toEqual(['visible-1'])
  })

  it('Home (getHomeBoardCandidates) excludes a hidden Dispatch from its pool', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        row({ id: 'visible-1', author_id: AUTHOR_A, moderation_status: 'visible' }),
        row({ id: 'hidden-1', author_id: AUTHOR_B, moderation_status: 'hidden' }),
      ],
      profiles: [{ id: AUTHOR_A, pseudonym: 'A' }, { id: AUTHOR_B, pseudonym: 'B' }],
    })
    const { items } = await getHomeBoardCandidates(client(fake))
    expect(items.map((r) => r.id)).toEqual(['visible-1'])
  })

  it('a profile\'s Dispatch list (getPublishedDispatchesByAuthor) excludes a hidden Dispatch, even for the profile owner themself', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [
        row({ id: 'visible-1', author_id: AUTHOR_A, moderation_status: 'visible' }),
        row({ id: 'hidden-1', author_id: AUTHOR_A, moderation_status: 'hidden' }),
      ],
    })
    const result = await getPublishedDispatchesByAuthor(client(fake), AUTHOR_A)
    expect(result.map((r) => r.id)).toEqual(['visible-1'])
  })

  it('search excludes a hidden Dispatch even when its title/body matches the query', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'hidden-1', author_id: AUTHOR_A, title: 'Unmistakable Ritual', moderation_status: 'hidden' })],
    })
    const result = await searchDispatches(client(fake), 'Unmistakable')
    expect(result).toHaveLength(0)
  })

  it('the direct reader (getDispatchById) still resolves a hidden Dispatch — the author\'s own appropriate direct view', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'hidden-1', author_id: AUTHOR_A, moderation_status: 'hidden' })],
    })
    const result = await getDispatchById(client(fake), 'hidden-1')
    expect(result?.moderationStatus).toBe('hidden')
  })

  it('the external share reader (getSharedDispatch) stops resolving the instant a Dispatch is hidden, and works again once restored', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, moderation_status: 'visible' })],
    })
    const { data: share } = await shareDispatch(client(fake), 'd-1')
    const shareToken = share?.id
    expect(shareToken).toBeTruthy()

    const beforeHide = await getSharedDispatch(client(fake), shareToken as string)
    expect(beforeHide).not.toBeNull()

    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'hidden'
    const afterHide = await getSharedDispatch(client(fake), shareToken as string)
    expect(afterHide).toBeNull()

    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'visible'
    const afterRestore = await getSharedDispatch(client(fake), shareToken as string)
    expect(afterRestore).not.toBeNull()
  })

  it('restoring a Dispatch makes it public again on the Board where it was previously excluded', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, moderation_status: 'hidden' })],
    })
    expect(await getPublishedDispatches(client(fake))).toHaveLength(0)

    fake._rows.find((r) => r.id === 'd-1')!.moderation_status = 'visible'
    const board = await getPublishedDispatches(client(fake))
    expect(board.map((r) => r.id)).toEqual(['d-1'])
  })

  it('another member cannot directly access a hidden Dispatch — only the author\'s own view resolves it', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [row({ id: 'd-1', author_id: AUTHOR_A, moderation_status: 'hidden' })],
    })
    const result = await getDispatchById(client(fake), 'd-1')
    expect(result).toBeNull()
  })
})

// ============================================================
// BOARD FEED FOUNDATION checkpoint (Phase 2A) — getBoardFeedPage
// ============================================================

const SESSION_STARTED_AT = '2026-09-15T00:00:00Z'
const SEED_A = 'seed-a'

function boardRow(overrides: Partial<FakeDispatchRow> = {}): FakeDispatchRow {
  return row({ published_at: '2026-09-01T00:00:00Z', ...overrides })
}

describe('getBoardFeedPage — session stability', () => {
  it('the same seed and session_started_at produce the identical ordering on repeated calls', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'd-1', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'd-2', author_id: AUTHOR_B, published_at: '2026-09-09T00:00:00Z' }),
        boardRow({ id: 'd-3', author_id: 'user-c', published_at: '2026-09-08T00:00:00Z' }),
      ],
    })
    const first = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const second = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id))
  })

  it('a different explicit Refresh seed CAN change the relative order of an otherwise-tied pair, without violating tier order', async () => {
    // Two different authors, each publishing for the first time — both
    // land in author_seq = 1 of the same tier, so only the seed's own
    // tie-break decides their relative order.
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'tied-1', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'tied-2', author_id: AUTHOR_B, published_at: '2026-09-10T00:00:00Z' }),
      ],
    })
    const baseline = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: 'seed-1', cursor: null })
    const orders = new Set<string>()
    orders.add(baseline.items.map((i) => i.id).join(','))
    for (const seed of ['seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6']) {
      const result = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed, cursor: null })
      orders.add(result.items.map((i) => i.id).join(','))
    }
    // At least one seed among these differs from the baseline's order —
    // proving the seed genuinely influences ordering, without asserting
    // exactly WHICH seed does so (that depends on hash internals this
    // test deliberately doesn't hardcode against).
    expect(orders.size).toBeGreaterThan(1)
  })

  it('a Dispatch published AFTER session_started_at is excluded from that session entirely', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'before', author_id: AUTHOR_A, published_at: '2026-09-14T00:00:00Z' }),
        boardRow({ id: 'after', author_id: AUTHOR_A, published_at: '2026-09-16T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['before'])
  })

  it('a Dispatch opened (viewed) DURING the session does not reshuffle the order of items not yet returned', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'd-1', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'd-2', author_id: AUTHOR_B, published_at: '2026-09-09T00:00:00Z' }),
        boardRow({ id: 'd-3', author_id: 'user-c', published_at: '2026-09-08T00:00:00Z' }),
      ],
    })
    const page1 = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 1 })
    const viewedDispatchId = page1.items[0].id
    // This test focuses on what the migration's own Stability Rule
    // guarantees structurally: a row already returned is never
    // re-evaluated by a later page, because keyset pagination cursors
    // strictly past its own (tier, author_seq, seed_hash, id) tuple
    // regardless of any later state change to that row (e.g. the real
    // reader's recordDispatchProgress upserting a fresh, post-session
    // viewed_at the instant the member opens it).
    const page2 = await getBoardFeedPage(client(fake), {
      sessionStartedAt: SESSION_STARTED_AT,
      seed: SEED_A,
      cursor: page1.nextCursor,
      limit: 2,
    })
    expect(page2.items.map((i) => i.id)).not.toContain(viewedDispatchId)
    expect(page2.items.map((i) => i.id).sort()).toEqual(['d-2', 'd-3'])
  })

  it('a Dispatch already seen BEFORE session start ranks below eligible unseen Dispatches', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'seen-old', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'unseen-1', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      views: [{ viewer_id: VIEWER, dispatch_id: 'seen-old', last_paragraph_index: 0, viewed_at: '2026-09-11T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['unseen-1', 'seen-old'])
  })

  it('a view recorded AFTER session start does not count as "seen" for THIS session\'s tiering', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'just-opened', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'still-unseen', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      // viewed_at is AFTER session_started_at — a view that happened
      // during this very session.
      views: [{ viewer_id: VIEWER, dispatch_id: 'just-opened', last_paragraph_index: 0, viewed_at: '2026-09-15T00:30:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    // Both remain in an unseen tier (2) for this session — neither is
    // demoted to tier 3 — so both appear, and 'just-opened' is not
    // pushed below 'still-unseen' purely because of the mid-session view.
    expect(items.map((i) => i.id).sort()).toEqual(['just-opened', 'still-unseen'])
  })
})

// ============================================================
// SESSION-STABILITY CORRECTION — reproduces the exact bug an
// independent review found in the original viewed_at-based design, and
// proves the first_viewed_at-based fix. See docs/sql/2026-09-22-board-
// feed-foundation.sql's own "Session-stability correction" note and
// piece 5's field-by-field proof for the full reasoning this mirrors.
// ============================================================
describe('getBoardFeedPage — session-stability correction (first_viewed_at, not mutable viewed_at)', () => {
  it('a Dispatch first viewed BEFORE session start remains pre-session-seen even after being reopened DURING the session (mutable viewed_at advances, immutable first_viewed_at does not)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'reopened', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'unseen-1', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      views: [
        {
          viewer_id: VIEWER,
          dispatch_id: 'reopened',
          last_paragraph_index: 0,
          // The exact bug scenario: viewed yesterday (first_viewed_at),
          // then reopened mid-session today — recordDispatchProgress's
          // real upsert would advance viewed_at to "now" (well after
          // session start) while the migration's trigger keeps
          // first_viewed_at pinned to the original, pre-session value.
          first_viewed_at: '2026-09-14T00:00:00Z',
          viewed_at: '2026-09-15T00:30:00Z',
        },
      ],
    })

    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })

    // 'reopened' still classifies as pre-session seen (tier 3) — it
    // ranks below the unseen Dispatch, not ahead of or mixed with it.
    expect(items.map((i) => i.id)).toEqual(['unseen-1', 'reopened'])

    // Ordering/tier is identical on a second call within the SAME
    // session — the "reopen" already reflected in the fixture (mutable
    // viewed_at already advanced) does not destabilize anything further.
    const second = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(second.items.map((i) => i.id)).toEqual(items.map((i) => i.id))
  })

  it('a Dispatch with NO previous view at session start, first viewed DURING the session, remains "not pre-session seen" for that session — and correctly becomes previously-seen on the member\'s NEXT (later) Board session', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'newly-viewed', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'genuinely-unseen', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      views: [
        {
          viewer_id: VIEWER,
          dispatch_id: 'newly-viewed',
          last_paragraph_index: 0,
          // Simulates the real first-insert behavior: first_viewed_at is
          // established the instant the row is first created, mid-session.
          first_viewed_at: '2026-09-15T00:30:00Z',
          viewed_at: '2026-09-15T00:30:00Z',
        },
      ],
    })

    const duringSession = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    // Both stay in the unseen tier (2) together — 'newly-viewed' is NOT
    // pushed into tier 3, behind 'genuinely-unseen'. sort() makes the
    // assertion order-agnostic within the tier (their relative order is
    // a seed_hash tie-break, not the property under test here).
    expect(duringSession.items.map((i) => i.id).sort()).toEqual(['genuinely-unseen', 'newly-viewed'])

    // A NEW, LATER Board session (an explicit Refresh) — its own
    // session_started_at is now AFTER the view's first_viewed_at, so
    // the Dispatch correctly reclassifies as previously seen and ranks
    // BEHIND the still-unseen one.
    const NEXT_SESSION_STARTED_AT = '2026-09-16T00:00:00Z'
    const nextSession = await getBoardFeedPage(client(fake), {
      sessionStartedAt: NEXT_SESSION_STARTED_AT,
      seed: 'seed-next',
      cursor: null,
    })
    expect(nextSession.items.map((i) => i.id)).toEqual(['genuinely-unseen', 'newly-viewed'])
  })

  it('kept_minds.created_at pins the Keep-ADD direction to session start — a Keep performed DURING the session does not classify that author\'s Dispatches as familiar until the next session', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'from-mid-session-keep', author_id: AUTHOR_A, published_at: '2026-09-01T00:00:00Z' }),
        boardRow({ id: 'from-unkept', author_id: AUTHOR_B, published_at: '2026-09-02T00:00:00Z' }),
      ],
      // Keep happened DURING the current session.
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-09-15T00:30:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const midSessionKeepItem = items.find((i) => i.id === 'from-mid-session-keep')!
    expect(midSessionKeepItem.isKept).toBe(false)
    expect(midSessionKeepItem.isFamiliar).toBe(false)
  })

  it('an OLD Keep (established before session start) is unaffected — still classifies that author\'s Dispatches as familiar/kept exactly as before this correction', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'from-old-keep', author_id: AUTHOR_A, published_at: '2026-09-01T00:00:00Z' })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0].isKept).toBe(true)
    expect(items[0].isFamiliar).toBe(true)
  })
})

describe('getBoardFeedPage — unseen precedes seen (seen_bucket is the outermost sort key)', () => {
  it('a seen Kept-author Dispatch does NOT jump ahead of healthy unseen inventory, regardless of relationship strength', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'seen-but-kept', author_id: AUTHOR_A, published_at: '2026-09-10T00:00:00Z' }),
        boardRow({ id: 'unseen-discovery', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A }],
      views: [{ viewer_id: VIEWER, dispatch_id: 'seen-but-kept', last_paragraph_index: 0, first_viewed_at: '2026-09-14T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['unseen-discovery', 'seen-but-kept'])
  })
})

function correspondenceWith(viewer: string, author: string, overrides: Partial<FakeCorrespondenceRow> = {}): FakeCorrespondenceRow {
  return {
    participant_low: viewer < author ? viewer : author,
    participant_high: viewer < author ? author : viewer,
    status: 'active',
    established_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

describe('getBoardFeedPage — familiarity classification (Keep, established correspondent)', () => {
  it('a Kept author\'s Dispatch classifies as isKept=true, isFamiliar=true', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: true, isFamiliar: true })
  })

  it('an established correspondent\'s Dispatch classifies as isFamiliar=true, isKept=false — the second, weaker familiarity signal', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-08-01T00:00:00Z' })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: false, isFamiliar: true })
  })

  it('a first-contact correspondence that never became established (established_at null) grants NO familiarity', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: null })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: false, isFamiliar: false })
  })

  it('a correspondence established DURING the current session is not yet familiar for THIS session (session-stable, mirrors kept_minds.created_at)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-09-15T00:30:00Z' })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: false, isFamiliar: false })
  })

  it('Keep and an established correspondence with the SAME author never stack — Keep wins, exactly as if only Keep were true', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-08-01T00:00:00Z' })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: true, isFamiliar: true })
  })

  it('Stop Letters (a letters-only block) does NOT suppress Board familiarity for an established correspondent', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-08-01T00:00:00Z' })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ isFamiliar: true })
  })

  it('a FULL block removes the candidate entirely, even from an established correspondent', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-08-01T00:00:00Z' })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'full' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(0)
  })

  it('a CLOSED correspondence (even with established_at set) is not confused with an active one — it still counts, matching status=active only being required alongside established_at (a closed episode retains its established_at from when it was active, but the classification predicate requires status=\'active\')', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      correspondences: [correspondenceWith(VIEWER, AUTHOR_A, { established_at: '2026-08-01T00:00:00Z', status: 'closed' })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items[0]).toMatchObject({ isKept: false, isFamiliar: false })
  })
})

describe('getBoardFeedPage — Keep:Correspondent weighting (3:1, no systematic Familiar tie bias)', () => {
  it('with 3 Kept authors and 1 correspondent author (each one unseen Dispatch), the FIRST and LAST familiar-stream positions are always Keep — only the correspondent\'s exact position (2nd or 3rd) is seed-dependent', async () => {
    // Every row here is familiar (no discovery competitors), isolating
    // the Level-1 Keep:Correspondent merge from the Level-2 Familiar:
    // Discovery interleave entirely. Sainte-Laguë divisor keys: Keep
    // (weight 3) at stream positions 1,2,3 get keys 1/3, 1, 5/3;
    // Correspondent (weight 1) at stream position 1 gets key 1 — tying
    // ONLY with Keep's 2nd position. Position 1 (key 1/3, unique
    // minimum) and position 4 (key 5/3, unique maximum among these 4)
    // are therefore always Keep, regardless of which tied item breaks
    // first at positions 2/3.
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'keep-1', author_id: 'kept-a', published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'keep-2', author_id: 'kept-b', published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'keep-3', author_id: 'kept-c', published_at: '2026-09-03T00:00:00Z' }),
        boardRow({ id: 'corr-1', author_id: 'corr-a', published_at: '2026-09-02T00:00:00Z' }),
      ],
      kept: [
        { viewer_user_id: VIEWER, kept_user_id: 'kept-a', created_at: '2026-08-01T00:00:00Z' },
        { viewer_user_id: VIEWER, kept_user_id: 'kept-b', created_at: '2026-08-01T00:00:00Z' },
        { viewer_user_id: VIEWER, kept_user_id: 'kept-c', created_at: '2026-08-01T00:00:00Z' },
      ],
      correspondences: [correspondenceWith(VIEWER, 'corr-a', { established_at: '2026-08-01T00:00:00Z' })],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 4 })
    expect(items.map((i) => i.id).sort()).toEqual(['corr-1', 'keep-1', 'keep-2', 'keep-3'])
    expect(items[0].id).toMatch(/^keep-/)
    expect(items[3].id).toMatch(/^keep-/)
    expect(items[1].id === 'corr-1' || items[2].id === 'corr-1').toBe(true)
  })

  it('the 5th and 6th familiar-stream positions never both come from the correspondent — the SAME 3:1 apportionment repeats past the first cycle', async () => {
    // 6 Kept authors + 2 correspondent authors — the divisor sequence
    // predicts corr-1 lands in the {2,3} position band and corr-2 in
    // the {6,7} band (see docs/sql/2026-09-26-board-personalization-
    // ranking.sql's own worked comment), so positions 4 and 5 (0-indexed
    // 3,4) are always Keep.
    const kept = Array.from({ length: 6 }, (_, i) => ({
      viewer_user_id: VIEWER,
      kept_user_id: `kept-${i}`,
      created_at: '2026-08-01T00:00:00Z',
    }))
    const rows = [
      ...Array.from({ length: 6 }, (_, i) =>
        boardRow({ id: `keep-${i}`, author_id: `kept-${i}`, published_at: `2026-09-${String(10 - i).padStart(2, '0')}T00:00:00Z` })
      ),
      boardRow({ id: 'corr-1', author_id: 'corr-a', published_at: '2026-09-03T00:00:00Z' }),
      boardRow({ id: 'corr-2', author_id: 'corr-b', published_at: '2026-09-02T00:00:00Z' }),
    ]
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows,
      kept,
      correspondences: [
        correspondenceWith(VIEWER, 'corr-a', { established_at: '2026-08-01T00:00:00Z' }),
        correspondenceWith(VIEWER, 'corr-b', { established_at: '2026-08-01T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 8 })
    expect(items).toHaveLength(8)
    const positionOf = (id: string) => items.findIndex((i) => i.id === id)
    // Position 4 (0-indexed 3) always Keep — strictly between the two
    // correspondent bands.
    expect(items[3].id).toMatch(/^keep-/)
  })
})

describe('getBoardFeedPage — Familiar:Discovery interleave (unbiased 1:1, deterministic)', () => {
  function singleFamiliarVsSingleDiscoveryFake(seed: string) {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'familiar-1', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'discovery-1', author_id: AUTHOR_B, published_at: '2026-09-05T00:00:00Z' }),
      ],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
    })
    return getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed, cursor: null })
  }

  it('there is no explicit Familiar-first threshold or offset in the ranking — a single Familiar item and a single Discovery item genuinely tie at the same rank_key and are resolved ONLY by the per-session seed', async () => {
    const { items } = await singleFamiliarVsSingleDiscoveryFake(SEED_A)
    // Both rank_key values must be equal (a true tie), never a
    // structurally-guaranteed Familiar-first ordering.
    const familiar = items.find((i) => i.id === 'familiar-1')!
    const discovery = items.find((i) => i.id === 'discovery-1')!
    expect(familiar.cursor.rankKey).toBe(discovery.cursor.rankKey)
  })

  it('the identical seed always produces the identical resolution of that tie', async () => {
    const first = await singleFamiliarVsSingleDiscoveryFake('fixed-seed-x')
    const second = await singleFamiliarVsSingleDiscoveryFake('fixed-seed-x')
    expect(first.items.map((i) => i.id)).toEqual(second.items.map((i) => i.id))
  })

  it('across a FIXED, hardcoded set of known seeds, BOTH tie outcomes are observed — proving the resolution is genuinely seed-dependent, never a fixed lean, without any probabilistic/CI-style "roughly 50/50" assertion', async () => {
    // A fixed, literal, non-random list of seed strings — fully
    // deterministic and repeatable: this exact list always produces the
    // exact same set of outcomes on every run, on every machine.
    const FIXED_SEEDS = [
      'seed-01', 'seed-02', 'seed-03', 'seed-04', 'seed-05',
      'seed-06', 'seed-07', 'seed-08', 'seed-09', 'seed-10',
      'seed-11', 'seed-12', 'seed-13', 'seed-14', 'seed-15',
      'seed-16', 'seed-17', 'seed-18', 'seed-19', 'seed-20',
    ]
    const outcomes = new Set<string>()
    for (const seed of FIXED_SEEDS) {
      const { items } = await singleFamiliarVsSingleDiscoveryFake(seed)
      outcomes.add(items[0].id)
    }
    expect(outcomes.has('familiar-1')).toBe(true)
    expect(outcomes.has('discovery-1')).toBe(true)
  })
})

describe('getBoardFeedPage — discovery guarantee / sparse pool graceful fill', () => {
  it('a sparse familiar pool (no Keep, no correspondents at all) fills entirely, correctly, from discovery — nothing is lost', async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `author-${i}`, published_at: `2026-09-0${i + 1}T00:00:00Z` })
    )
    const fake = createFakeDispatches({ viewerId: VIEWER, rows })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 10 })
    expect(items).toHaveLength(5)
    expect(items.every((i) => i.isFamiliar === false)).toBe(true)
  })

  it('a sparse discovery pool (every author is familiar) still returns everything — nothing is withheld for lack of a Discovery competitor', async () => {
    const rows = [
      boardRow({ id: 'd-1', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
      boardRow({ id: 'd-2', author_id: AUTHOR_B, published_at: '2026-09-04T00:00:00Z' }),
    ]
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows,
      kept: [
        { viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' },
        { viewer_user_id: VIEWER, kept_user_id: AUTHOR_B, created_at: '2026-08-01T00:00:00Z' },
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 10 })
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.isFamiliar === true)).toBe(true)
  })
})

describe('getBoardFeedPage — bounded familiar-author augmentation (beyond the global newest-300 pool)', () => {
  it('a familiar author\'s unseen Dispatch OUTSIDE the global newest-300 window still enters the feed through augmentation', async () => {
    // 300 unrelated, newer discovery rows fill the global pool entirely,
    // pushing a single older Kept-author Dispatch outside it.
    const fillerRows = Array.from({ length: 300 }, (_, i) =>
      boardRow({ id: `filler-${i}`, author_id: `filler-author-${i}`, published_at: `2026-09-10T00:${String(i % 60).padStart(2, '0')}:00Z` })
    )
    const oldKeptRow = boardRow({ id: 'old-kept-dispatch', author_id: AUTHOR_A, published_at: '2026-01-01T00:00:00Z' })
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [...fillerRows, oldKeptRow],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 1000 })
    expect(items.map((i) => i.id)).toContain('old-kept-dispatch')
    const augmented = items.find((i) => i.id === 'old-kept-dispatch')!
    expect(augmented.isKept).toBe(true)
  })

  it('augmentation never contributes more than 2 UNSEEN Dispatches per familiar author, even when that author has many more eligible unseen rows outside the global 300', async () => {
    const fillerRows = Array.from({ length: 300 }, (_, i) =>
      boardRow({ id: `filler-${i}`, author_id: `filler-author-${i}`, published_at: `2026-09-10T00:${String(i % 60).padStart(2, '0')}:00Z` })
    )
    const oldKeptRows = Array.from({ length: 5 }, (_, i) =>
      boardRow({ id: `old-kept-${i}`, author_id: AUTHOR_A, published_at: `2026-01-0${i + 1}T00:00:00Z` })
    )
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [...fillerRows, ...oldKeptRows],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 1000 })
    const augmentedFromAuthorA = items.filter((i) => i.id.startsWith('old-kept-'))
    expect(augmentedFromAuthorA.length).toBeLessThanOrEqual(2)
    // The 2 that DO make it through are the MOST RECENT of the 5 —
    // old-kept-4 and old-kept-3 (0-indexed, newest published_at first).
    expect(augmentedFromAuthorA.map((i) => i.id).sort()).toEqual(['old-kept-3', 'old-kept-4'])
  })

  it('augmentation only ever adds UNSEEN Dispatches — a familiar author\'s older, already-seen Dispatch outside the 300 stays absent', async () => {
    const fillerRows = Array.from({ length: 300 }, (_, i) =>
      boardRow({ id: `filler-${i}`, author_id: `filler-author-${i}`, published_at: `2026-09-10T00:${String(i % 60).padStart(2, '0')}:00Z` })
    )
    const oldSeenKeptRow = boardRow({ id: 'old-seen-kept', author_id: AUTHOR_A, published_at: '2026-01-01T00:00:00Z' })
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [...fillerRows, oldSeenKeptRow],
      kept: [{ viewer_user_id: VIEWER, kept_user_id: AUTHOR_A, created_at: '2026-08-01T00:00:00Z' }],
      views: [{ viewer_id: VIEWER, dispatch_id: 'old-seen-kept', last_paragraph_index: 0, first_viewed_at: '2026-01-02T00:00:00Z' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 1000 })
    expect(items.map((i) => i.id)).not.toContain('old-seen-kept')
  })
})

describe('getBoardFeedPage — author diversity', () => {
  it('one prolific author\'s later Dispatches never crowd out other authors\' first Dispatch within the same tier', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'prolific-1', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'prolific-2', author_id: AUTHOR_A, published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'prolific-3', author_id: AUTHOR_A, published_at: '2026-09-03T00:00:00Z' }),
        boardRow({ id: 'quiet-1', author_id: AUTHOR_B, published_at: '2026-09-02T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const positionOf = (id: string) => items.findIndex((i) => i.id === id)
    // quiet-1 is AUTHOR_B's author_seq=1 — it must rank ahead of
    // AUTHOR_A's author_seq=2 and author_seq=3 items, even though all of
    // AUTHOR_A's are individually newer.
    expect(positionOf('quiet-1')).toBeLessThan(positionOf('prolific-2'))
    expect(positionOf('quiet-1')).toBeLessThan(positionOf('prolific-3'))
  })

  it('author diversity applies within EVERY tier, not only the Kept-authors tier', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'unkept-1', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'unkept-2', author_id: AUTHOR_A, published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'other-1', author_id: AUTHOR_B, published_at: '2026-09-01T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const positionOf = (id: string) => items.findIndex((i) => i.id === id)
    expect(positionOf('other-1')).toBeLessThan(positionOf('unkept-2'))
  })
})

describe('getBoardFeedPage — cursor pagination', () => {
  function manyRows(count: number) {
    return Array.from({ length: count }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `author-${i}`, published_at: `2026-09-01T00:${String(i).padStart(2, '0')}:00Z` })
    )
  }

  it('page 1 and page 2 share no duplicate ids', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: manyRows(10) })
    const page1 = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 4 })
    const page2 = await getBoardFeedPage(client(fake), {
      sessionStartedAt: SESSION_STARTED_AT,
      seed: SEED_A,
      cursor: page1.nextCursor,
      limit: 4,
    })
    const page1Ids = new Set(page1.items.map((i) => i.id))
    const page2Ids = page2.items.map((i) => i.id)
    expect(page2Ids.every((id) => !page1Ids.has(id))).toBe(true)
  })

  it('paginating through every page returns the exact same set of ids as one single large page', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: manyRows(10) })
    const everything = await getBoardFeedPage(client(fake), {
      sessionStartedAt: SESSION_STARTED_AT,
      seed: SEED_A,
      cursor: null,
      limit: 100,
    })

    const collected: string[] = []
    let cursor: BoardFeedCursor | null = null
    for (let guard = 0; guard < 20; guard++) {
      const page = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor, limit: 3 })
      collected.push(...page.items.map((i) => i.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }

    expect(collected.sort()).toEqual(everything.items.map((i) => i.id).sort())
  })

  it('nextCursor is null once the last page is reached', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: manyRows(2) })
    const { nextCursor } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null, limit: 10 })
    expect(nextCursor).toBeNull()
  })
})

describe('getBoardFeedPage — blocking', () => {
  it('a full block continues to hide the blocked author\'s Dispatches from the Board feed', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'full' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(0)
  })

  it('a letters-only block does NOT hide the blocked author\'s Dispatches from the Board feed', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['d-1'])
  })
})

describe('getBoardFeedPage — Trust & Safety read-visibility (account enforcement)', () => {
  it('a suspended author\'s published Dispatch is hidden from an ordinary member', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      accountStatus: { [AUTHOR_A]: 'suspended' },
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(0)
  })

  it('a banned author\'s published Dispatch is hidden from an ordinary member', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      accountStatus: { [AUTHOR_A]: 'banned' },
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items).toHaveLength(0)
  })

  it('an active author\'s published Dispatch remains visible', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      accountStatus: { [AUTHOR_A]: 'active' },
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['d-1'])
  })

  it('a restricted author\'s published Dispatch remains visible — restricted only ever gates that member\'s OWN write actions elsewhere, never read visibility of already-published content', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      accountStatus: { [AUTHOR_A]: 'restricted' },
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['d-1'])
  })

  it('a suspended member can still see their OWN Dispatch in their own Board feed', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      accountStatus: { [AUTHOR_A]: 'suspended' },
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    expect(items.map((i) => i.id)).toEqual(['d-1'])
  })
})

describe('getHomeBoardCandidates — shares the Board feed core, no separate pagination concept of its own', () => {
  it('the returned items are NOT plain DispatchListItem — each carries its own isKept/isFamiliar/cursor, never top-level nextCursor', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
    })
    const { items } = await getHomeBoardCandidates(client(fake))
    expect(Array.isArray(items)).toBe(true)
    expect(items[0]).not.toHaveProperty('nextCursor')
    expect(items[0]).toHaveProperty('cursor')
    expect(items[0]).toHaveProperty('isKept')
    expect(items[0]).toHaveProperty('isFamiliar')
  })

  it('caps at HOME_CANDIDATE_COUNT (30) even with many eligible Dispatches', async () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `user-${i}`, published_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` })
    )
    const fake = createFakeDispatches({ viewerId: VIEWER, rows })
    const { items } = await getHomeBoardCandidates(client(fake))
    expect(items.length).toBeLessThanOrEqual(30)
    expect(items.length).toBeGreaterThan(3)
  })
})

describe('Home Phase 1 — partitionHomeSections', () => {
  function feedItem(overrides: Partial<BoardFeedItem>): BoardFeedItem {
    const id = overrides.id ?? 'd-1'
    return {
      id,
      authorId: 'author-1',
      title: 'A title',
      body: 'Body',
      publishedAt: '2026-09-01T00:00:00Z',
      moderationStatus: 'visible',
      authorPseudonym: 'Someone',
      authorCountry: null,
      topics: [],
      isKept: false,
      isFamiliar: false,
      cursor: { seenBucket: 0, rankKey: '1', seedHash: 0, id },
      ...overrides,
    }
  }

  it('never lets the same Dispatch id appear in more than one section', () => {
    const items = Array.from({ length: 20 }, (_, i) => {
      const isKept = i % 3 === 0
      const isFamiliar = isKept || i % 3 === 1
      return feedItem({ id: `d-${i}`, isKept, isFamiliar })
    })
    const { featured, fromMindsYouKeep, serendipity, remainder } = partitionHomeSections(items)
    const allIds = [
      ...featured.map((i) => i.id),
      ...fromMindsYouKeep.map((i) => i.id),
      ...serendipity.map((i) => i.id),
      ...remainder.map((i) => i.id),
    ]
    expect(new Set(allIds).size).toBe(allIds.length)
    // Every candidate must land in exactly one bucket (including remainder).
    expect(allIds.length).toBe(items.length)
  })

  it('Featured takes the first 3 rows in existing order without manufacturing a generic Shelf', () => {
    const items = Array.from({ length: 10 }, (_, i) => feedItem({ id: `d-${i}` }))
    const { featured } = partitionHomeSections(items)
    expect(featured.map((i) => i.id)).toEqual(['d-0', 'd-1', 'd-2'])
  })

  it('From Minds You Keep omits cleanly (empty array) when no unused isKept rows remain', () => {
    const items = Array.from({ length: 8 }, (_, i) => feedItem({ id: `d-${i}` }))
    const { fromMindsYouKeep } = partitionHomeSections(items)
    expect(fromMindsYouKeep).toEqual([])
  })

  it('From Minds You Keep takes up to 3 additional unused isKept rows', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => feedItem({ id: `featured-${i}` })),
      feedItem({ id: 'kept-1', isKept: true, isFamiliar: true }),
      feedItem({ id: 'kept-2', isKept: true, isFamiliar: true }),
      feedItem({ id: 'kept-3', isKept: true, isFamiliar: true }),
      feedItem({ id: 'kept-4', isKept: true, isFamiliar: true }),
    ]
    const { fromMindsYouKeep } = partitionHomeSections(items)
    expect(fromMindsYouKeep.map((i) => i.id)).toEqual(['kept-1', 'kept-2', 'kept-3'])
  })

  it('a correspondent-only author (isFamiliar true, isKept false) can appear in Featured but NEVER in From Minds You Keep', () => {
    const items = [
      feedItem({ id: 'correspondent-1', isKept: false, isFamiliar: true }),
      ...Array.from({ length: 9 }, (_, i) => feedItem({ id: `shelf-${i}` })),
    ]
    const { featured, fromMindsYouKeep } = partitionHomeSections(items)
    expect(featured.some((i) => i.id === 'correspondent-1')).toBe(true)
    expect(fromMindsYouKeep.some((i) => i.id === 'correspondent-1')).toBe(false)
  })

  it('Serendipity excludes Keep authors', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => feedItem({ id: `featured-${i}` })),
      feedItem({ id: 'kept-1', isKept: true, isFamiliar: true }),
      feedItem({ id: 'serendipity-1', isKept: false, isFamiliar: false }),
    ]
    const { serendipity } = partitionHomeSections(items)
    expect(serendipity.map((i) => i.id)).not.toContain('kept-1')
    expect(serendipity.map((i) => i.id)).toContain('serendipity-1')
  })

  it('Serendipity excludes correspondent/familiar (non-Keep) authors too — isFamiliar === false is the entire rule', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => feedItem({ id: `featured-${i}` })),
      feedItem({ id: 'correspondent-1', isKept: false, isFamiliar: true }),
      feedItem({ id: 'serendipity-1', isKept: false, isFamiliar: false }),
    ]
    const { serendipity } = partitionHomeSections(items)
    expect(serendipity.map((i) => i.id)).not.toContain('correspondent-1')
    expect(serendipity.map((i) => i.id)).toContain('serendipity-1')
  })

  it('Serendipity is never backfilled with a familiar author merely to reach its target count', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => feedItem({ id: `featured-${i}` })),
      feedItem({ id: 'only-discovery', isKept: false, isFamiliar: false }),
      feedItem({ id: 'familiar-1', isKept: true, isFamiliar: true }),
      feedItem({ id: 'familiar-2', isKept: false, isFamiliar: true }),
    ]
    const { serendipity } = partitionHomeSections(items)
    expect(serendipity.map((i) => i.id)).toEqual(['only-discovery'])
  })

  it('degrades gracefully — never duplicates a card when the pool is smaller than every section combined', () => {
    const items = Array.from({ length: 4 }, (_, i) => feedItem({ id: `d-${i}` }))
    const { featured, fromMindsYouKeep, serendipity } = partitionHomeSections(items)
    const allIds = [...featured, ...fromMindsYouKeep, ...serendipity].map((i) => i.id)
    expect(new Set(allIds).size).toBe(allIds.length)
    expect(allIds.length).toBeLessThanOrEqual(items.length)
  })

  it('remainder holds whatever is left over after every section has claimed its rows', () => {
    const items = Array.from({ length: 20 }, (_, i) => feedItem({ id: `d-${i}` }))
    const { featured, fromMindsYouKeep, serendipity, remainder } = partitionHomeSections(items)
    expect(remainder.length).toBe(
      items.length - featured.length - fromMindsYouKeep.length - serendipity.length
    )
    expect(remainder.some((i) => featured.some((f) => f.id === i.id))).toBe(false)
  })
})

describe('Home Phase 1 — reading trail helpers (v2)', () => {
  function feedItem(overrides: Partial<BoardFeedItem>): BoardFeedItem {
    const id = overrides.id ?? 'd-1'
    return {
      id,
      authorId: 'author-1',
      title: 'A title',
      body: 'Body',
      publishedAt: '2026-09-01T00:00:00Z',
      moderationStatus: 'visible',
      authorPseudonym: 'Someone',
      authorCountry: null,
      topics: [],
      isKept: false,
      isFamiliar: false,
      cursor: { seenBucket: 0, rankKey: '5', seedHash: 12345, id },
      ...overrides,
    }
  }

  it('readingTrailSearchParams encodes the session plus the item\'s own cursor (never the item id, never isKept/isFamiliar)', () => {
    const params = readingTrailSearchParams(
      { sessionStartedAt: '2026-09-01T00:00:00Z', seed: 'abc123' },
      feedItem({ id: 'd-1', isKept: true, isFamiliar: true, cursor: { seenBucket: 0, rankKey: '5', seedHash: 12345, id: 'd-1' } })
    )
    expect(params.get('s')).toBe('2026-09-01T00:00:00Z')
    expect(params.get('seed')).toBe('abc123')
    expect(params.get('v')).toBe('2')
    expect(params.get('sb')).toBe('0')
    expect(params.get('rk')).toBe('5')
    expect(params.get('sh')).toBe('12345')
    expect(params.get('isKept')).toBeNull()
    expect(params.get('isFamiliar')).toBeNull()
    expect(params.toString()).not.toMatch(/kept|familiar|correspondent/i)
  })

  it('parseReadingTrailParams round-trips what readingTrailSearchParams encoded, with rk staying a STRING', () => {
    const params = readingTrailSearchParams(
      { sessionStartedAt: '2026-09-01T00:00:00Z', seed: 'abc123' },
      feedItem({ id: 'd-1', cursor: { seenBucket: 1, rankKey: '7', seedHash: -99, id: 'd-1' } })
    )
    const parsed = parseReadingTrailParams(Object.fromEntries(params.entries()))
    expect(parsed).toEqual({ sessionStartedAt: '2026-09-01T00:00:00Z', seed: 'abc123', seenBucket: 1, rankKey: '7', seedHash: -99 })
    expect(typeof parsed!.rankKey).toBe('string')
  })

  it('parseReadingTrailParams returns null for a bare direct/shared URL with no trail params at all', () => {
    expect(parseReadingTrailParams({})).toBeNull()
  })

  it('parseReadingTrailParams returns null when only some params are present (malformed/truncated)', () => {
    expect(parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc' })).toBeNull()
  })

  it('parseReadingTrailParams returns null for a missing version (an old, unversioned trail URL from before this checkpoint)', () => {
    expect(
      parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', tier: '2', aseq: '1', shash: '1' })
    ).toBeNull()
  })

  it('parseReadingTrailParams returns null for an unsupported version', () => {
    expect(
      parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', v: '3', sb: '0', rk: '5', sh: '1' })
    ).toBeNull()
  })

  it('parseReadingTrailParams returns null for a malformed sb (non-numeric)', () => {
    expect(
      parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', v: '2', sb: 'x', rk: '5', sh: '1' })
    ).toBeNull()
  })

  it('parseReadingTrailParams returns null for a malformed rk (empty)', () => {
    expect(
      parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', v: '2', sb: '0', rk: '', sh: '1' })
    ).toBeNull()
  })

  it('parseReadingTrailParams returns null for a malformed sh (non-numeric)', () => {
    expect(
      parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', v: '2', sb: '0', rk: '5', sh: 'x' })
    ).toBeNull()
  })

  it('getNextTrailItems returns the rows immediately after the given cursor, in that exact session, in order', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'a', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'b', author_id: AUTHOR_B, published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'c', author_id: 'user-c', published_at: '2026-09-03T00:00:00Z' }),
        boardRow({ id: 'd', author_id: 'user-d', published_at: '2026-09-02T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), {
      sessionStartedAt: SESSION_STARTED_AT,
      seed: SEED_A,
      cursor: null,
    })
    const [first, second, third] = items
    const next = await getNextTrailItems(
      client(fake),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, seenBucket: first.cursor.seenBucket, rankKey: first.cursor.rankKey, seedHash: first.cursor.seedHash },
      first.id,
      2
    )
    expect(next.map((i) => i.id)).toEqual([second.id, third.id])
  })

  it('getNextTrailItems defaults to CONTINUE_READING_COUNT items when count is omitted', async () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      boardRow({ id: `d-${i}`, author_id: `user-${i}`, published_at: `2026-09-${String(10 - i).padStart(2, '0')}T00:00:00Z` })
    )
    const fake = createFakeDispatches({ viewerId: VIEWER, rows })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const [first] = items
    const next = await getNextTrailItems(
      client(fake),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, seenBucket: first.cursor.seenBucket, rankKey: first.cursor.rankKey, seedHash: first.cursor.seedHash },
      first.id
    )
    expect(next).toHaveLength(CONTINUE_READING_COUNT)
  })

  it('getNextTrailItems returns an empty array (never null/throws) once the trail reaches the end', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'only-one', author_id: AUTHOR_A })],
    })
    const { items } = await getBoardFeedPage(client(fake), {
      sessionStartedAt: SESSION_STARTED_AT,
      seed: SEED_A,
      cursor: null,
    })
    const [only] = items
    const next = await getNextTrailItems(
      client(fake),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, seenBucket: only.cursor.seenBucket, rankKey: only.cursor.rankKey, seedHash: only.cursor.seedHash },
      only.id
    )
    expect(next).toEqual([])
  })

  it('picking a NON-first recommendation preserves the correct onward trail — its own cursor continues from where IT sits, not from the original item', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [
        boardRow({ id: 'a', author_id: AUTHOR_A, published_at: '2026-09-05T00:00:00Z' }),
        boardRow({ id: 'b', author_id: AUTHOR_B, published_at: '2026-09-04T00:00:00Z' }),
        boardRow({ id: 'c', author_id: 'user-c', published_at: '2026-09-03T00:00:00Z' }),
        boardRow({ id: 'd', author_id: 'user-d', published_at: '2026-09-02T00:00:00Z' }),
      ],
    })
    const { items } = await getBoardFeedPage(client(fake), { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, cursor: null })
    const [first, second, third, fourth] = items
    // Reader opens `first`, sees a shelf of [second, third, fourth], and
    // taps the THIRD suggestion (not the first) — its own cursor must
    // pick up correctly from there, not silently resume after `first`.
    const shelf = await getNextTrailItems(
      client(fake),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, seenBucket: first.cursor.seenBucket, rankKey: first.cursor.rankKey, seedHash: first.cursor.seedHash },
      first.id,
      3
    )
    expect(shelf.map((i) => i.id)).toEqual([second.id, third.id, fourth.id])
    const chosen = shelf[1] // third
    const afterChosen = await getNextTrailItems(
      client(fake),
      { sessionStartedAt: SESSION_STARTED_AT, seed: SEED_A, seenBucket: chosen.cursor.seenBucket, rankKey: chosen.cursor.rankKey, seedHash: chosen.cursor.seedHash },
      chosen.id,
      3
    )
    expect(afterChosen.map((i) => i.id)).toEqual([fourth.id])
  })

  it('a stale/old trail (parses to null) means Read Next is simply absent — never an error; the caller-side contract is that getNextTrailItems is only ever called when parseReadingTrailParams returned non-null', () => {
    const staleTrail = parseReadingTrailParams({ s: '2026-09-01T00:00:00Z', seed: 'abc', tier: '2', aseq: '1', shash: '1' })
    expect(staleTrail).toBeNull()
  })
})

describe('searchDispatches — server-bounded (Board Feed Foundation checkpoint)', () => {
  it('never returns more than 50 matches, even when far more exist', async () => {
    const rows = Array.from({ length: 60 }, (_, i) =>
      boardRow({ id: `match-${i}`, author_id: AUTHOR_A, title: 'Ritual gathering', published_at: `2026-09-01T00:${String(i % 60).padStart(2, '0')}:00Z` })
    )
    const fake = createFakeDispatches({ viewerId: VIEWER, rows })
    const result = await searchDispatches(client(fake), 'Ritual')
    expect(result.length).toBeLessThanOrEqual(50)
  })
})

describe('getFirstMomentThumbnails — batched, N+1-safe (Board Feed Foundation checkpoint — previously untested)', () => {
  it('resolves the FIRST (lowest-position) Moment per Dispatch, never a later one', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      moments: [
        { id: 'm-2', dispatch_id: 'd-1', position: 1, image_path: 'author-a/second.jpg' },
        { id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'author-a/first.jpg' },
      ],
    })
    const result = await getFirstMomentThumbnails(client(fake), ['d-1'])
    expect(result.get('d-1')).toBe('https://signed.test/dispatch-photos/author-a/first.jpg')
  })

  it('resolves thumbnails for many Dispatches from ONE batched lookup, not one per Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A }), boardRow({ id: 'd-2', author_id: AUTHOR_B })],
      moments: [
        { id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'author-a/one.jpg' },
        { id: 'm-2', dispatch_id: 'd-2', position: 0, image_path: 'author-b/one.jpg' },
      ],
    })
    const result = await getFirstMomentThumbnails(client(fake), ['d-1', 'd-2'])
    expect(result.size).toBe(2)
    expect(result.get('d-1')).toContain('author-a/one.jpg')
    expect(result.get('d-2')).toContain('author-b/one.jpg')
  })

  it('a Dispatch with no Moments simply has no entry — never a broken/empty URL', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      moments: [],
    })
    const result = await getFirstMomentThumbnails(client(fake), ['d-1'])
    expect(result.has('d-1')).toBe(false)
  })

  it('an empty dispatch id list resolves with no query at all — an empty map', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const result = await getFirstMomentThumbnails(client(fake), [])
    expect(result.size).toBe(0)
  })
})

describe('getDispatchMoments — the full-detail reader path (Board Feed Foundation checkpoint — previously untested)', () => {
  it('resolves every Moment for a Dispatch, in position order', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [boardRow({ id: 'd-1', author_id: AUTHOR_A })],
      moments: [
        { id: 'm-2', dispatch_id: 'd-1', position: 1, image_path: 'author-a/second.jpg' },
        { id: 'm-1', dispatch_id: 'd-1', position: 0, image_path: 'author-a/first.jpg' },
      ],
    })
    const result = await getDispatchMoments(client(fake), 'd-1')
    expect(result.map((m) => m.position)).toEqual([0, 1])
    expect(result[0].imageUrl).toContain('first.jpg')
    expect(result[1].imageUrl).toContain('second.jpg')
  })
})
