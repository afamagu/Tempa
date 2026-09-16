import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import BoardFeed from './board-feed'
import type { BoardFeedCursor, BoardFeedItem } from '@/lib/dispatches'

// Board Load More resilience checkpoint — BoardFeed had no test file at
// all before this checkpoint. Same SSR-only limitation as every other
// interactive/async client component in this codebase (see e.g.
// letterhead-postcard.test.tsx's own doc comment: "mounted only after a
// real click, which this SSR-only harness can't simulate — verified via
// source-text inspection instead, per this codebase's established
// convention"). This file's environment is plain Node (vitest.config.ts:
// environment: 'node', no jsdom anywhere in this repo, no
// @testing-library/react dependency) — so, matching that same
// established convention:
//   - whatever is genuinely prop-driven at first render (idle state,
//     end-of-feed with no cursor) is proven with a real
//     renderToStaticMarkup render;
//   - the failure/retry state machine, which only ever changes AFTER an
//     async loadMore() call settles, is proven via precise, scoped
//     source-text inspection of the actual shipped implementation —
//     never merely "the word appears somewhere," but structural
//     placement (inside/outside the catch block, before/after the
//     try, which setters each branch calls).

const SOURCE_PATH = path.join(__dirname, 'board-feed.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

const CURSOR: BoardFeedCursor = { seenBucket: 0, rankKey: '1', seedHash: 42, id: 'd-1' }

function item(overrides: Partial<BoardFeedItem> = {}): BoardFeedItem {
  return {
    id: 'd-1',
    // Same authorId as the viewer used in every render() below, so
    // BoardFeed never renders a keepSlot/KeepButton — irrelevant to this
    // checkpoint and no reason to drag its own dependencies into these
    // fixtures.
    authorId: 'viewer-1',
    authorPseudonym: 'Evening Quill',
    authorCountry: null,
    title: 'A quiet morning ritual',
    body: 'A short Dispatch, long enough that the excerpt has something to clamp against.',
    publishedAt: '2026-09-07T12:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    isKept: false,
    isFamiliar: false,
    cursor: CURSOR,
    ...overrides,
  }
}

function render(overrides: Partial<Parameters<typeof BoardFeed>[0]> = {}) {
  return renderToStaticMarkup(
    <BoardFeed
      viewerId="viewer-1"
      sessionStartedAt="2026-09-07T00:00:00Z"
      seed="seed1"
      initialDispatches={[item()]}
      initialThumbnails={{}}
      initialCursor={CURSOR}
      initialKeptUserIds={[]}
      pageSize={12}
      {...overrides}
    />
  )
}

describe('BoardFeed — idle render (real props, no interaction needed)', () => {
  it('renders the loaded Dispatch(es)', () => {
    const html = render()
    expect(html).toContain('A quiet morning ritual')
  })

  it('shows the idle "More from the Board" control when a cursor exists, with no error/retry copy present', () => {
    const html = render()
    expect(html).toContain('More from the Board')
    expect(html).not.toContain("Tempa couldn")
    expect(html).not.toContain('Try again')
  })

  it('8. genuine end-of-feed (no cursor): no pagination control, no failure message, no "Try again" — unchanged from before this checkpoint', () => {
    const html = render({ initialCursor: null })
    expect(html).not.toContain('More from the Board')
    expect(html).not.toContain("Tempa couldn")
    expect(html).not.toContain('Try again')
  })

  it('an end-of-feed render still shows the already-loaded Dispatch(es) — absence of a cursor never hides existing content', () => {
    const html = render({ initialCursor: null })
    expect(html).toContain('A quiet morning ritual')
  })
})

// Extracts loadMore's own function body as a precise, bounded region —
// never the whole file — so every assertion below is scoped to exactly
// the code that runs on a "Load more"/"Try again" click, and cannot be
// satisfied by an unrelated match elsewhere (e.g. inside the JSX).
function loadMoreBody(): string {
  const start = source.indexOf('async function loadMore() {')
  expect(start, 'expected to find loadMore() in board-feed.tsx').toBeGreaterThan(-1)
  const end = source.indexOf('\n  return (', start)
  expect(end, 'expected to find the JSX return after loadMore()').toBeGreaterThan(start)
  return source.slice(start, end)
}

function tryBlockBody(body: string): string {
  const start = body.indexOf('try {')
  const end = body.indexOf('} catch', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return body.slice(start, end)
}

function catchBlockBody(body: string): string {
  const start = body.indexOf('} catch')
  const end = body.indexOf('} finally', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return body.slice(start, end)
}

describe('BoardFeed — 1/4. a failed request never mutates existing Dispatches, thumbnails, or the cursor', () => {
  const body = loadMoreBody()
  const catchBody = catchBlockBody(body)

  it('the catch block calls none of setDispatches/setThumbnails/setCursor — only the failure flag', () => {
    expect(catchBody).not.toContain('setDispatches')
    expect(catchBody).not.toContain('setThumbnails')
    expect(catchBody).not.toContain('setCursor')
    expect(catchBody).toContain('setLoadMoreFailed(true)')
  })

  it('setDispatches/setThumbnails/setCursor are called exactly once each in the whole function, all inside the try block (the success path only)', () => {
    const tryBody = tryBlockBody(body)
    for (const setter of ['setDispatches', 'setThumbnails', 'setCursor']) {
      const occurrencesInFunction = (body.match(new RegExp(setter, 'g')) ?? []).length
      const occurrencesInTry = (tryBody.match(new RegExp(setter, 'g')) ?? []).length
      expect(occurrencesInFunction).toBe(1)
      expect(occurrencesInTry).toBe(1)
    }
  })

  it('the success path appends via a functional updater ([...prev, ...items]) — it can never discard already-loaded Dispatches, even on a later failed page', () => {
    expect(body).toContain('setDispatches((prev) => [...prev, ...items])')
  })
})

describe('BoardFeed — 4/6. a failed request cannot mark the feed as exhausted (end-of-feed is a successful, deliberate signal only)', () => {
  const body = loadMoreBody()

  it('nextCursor (which can be null) is only ever produced and applied inside the try block, never guessed/defaulted in the catch', () => {
    expect(body).toContain('const { items, nextCursor } = await getBoardFeedPage(')
    expect(tryBlockBody(body)).toContain('setCursor(nextCursor)')
    expect(catchBlockBody(body)).not.toContain('nextCursor')
  })
})

describe('BoardFeed — 2/3. the approved calm failure message and retry label are wired to the failure flag', () => {
  it('the exact approved copy renders only when loadMoreFailed is true, as a restrained status (never role="alert", never red)', () => {
    expect(source).toContain(
      '{loadMoreFailed && (\n            <p role="status" className={helperTextClass}>\n              Tempa couldn&rsquo;t bring in more Dispatches just now.\n            </p>\n          )}'
    )
    expect(source).not.toContain('role="alert"')
    expect(source).not.toContain('text-red')
  })

  it('the SAME pagination button relabels to "Try again" when loadMoreFailed is true — never a second, separate retry button', () => {
    expect(source).toContain("{loading ? 'Loading…' : loadMoreFailed ? 'Try again' : 'More from the Board'}")
    // Exactly one <button> is defined inside the cursor-gated pagination
    // block — proven by there being only one onClick={loadMore} in the
    // whole file (the Back-to-top control has its own separate handler).
    expect((source.match(/onClick=\{loadMore\}/g) ?? []).length).toBe(1)
  })

  it('the retry control is a real <button type="button">, keyboard-activatable, never a bare clickable <div>/<span>', () => {
    expect(source).toMatch(/<button\s+type="button"\s+onClick=\{loadMore\}/)
  })
})

describe('BoardFeed — 5/6. retry travels through the exact same loadMore() function, using the exact same (un-advanced) cursor', () => {
  it('there is only one function capable of issuing a "Load more" request — no separate retryLoadMore/handleRetry', () => {
    expect(source).not.toMatch(/function retry/i)
    expect((source.match(/async function loadMore/g) ?? []).length).toBe(1)
  })

  it('the request always reads the component\'s own current `cursor` state directly — never a cloned/frozen copy captured at a different time', () => {
    const body = loadMoreBody()
    expect(body).toContain('cursor,\n        limit: pageSize,')
  })
})

describe('BoardFeed — 5(new-attempt). every new attempt (first load or retry) clears stale failure state before the request starts', () => {
  it('setLoadMoreFailed(false) runs before the try block, unconditionally, on every call', () => {
    const body = loadMoreBody()
    const clearIndex = body.indexOf('setLoadMoreFailed(false)')
    const tryIndex = body.indexOf('try {')
    expect(clearIndex).toBeGreaterThan(-1)
    expect(tryIndex).toBeGreaterThan(clearIndex)
  })
})

describe('BoardFeed — 9. the pre-existing concurrent-request guard still applies to a retry click, unchanged', () => {
  it('loadMore still bails out immediately while a request is already in flight or no cursor exists', () => {
    const body = loadMoreBody()
    expect(body).toContain('if (loading || !cursor) return')
  })

  it('the button is disabled while loading, for both the idle and the failed/retry label', () => {
    expect(source).toContain('disabled={loading}')
  })
})

describe('BoardFeed — accessibility: no automatic focus theft introduced by this checkpoint', () => {
  it('no .focus() call and no autoFocus prop anywhere in the file', () => {
    expect(source).not.toContain('.focus()')
    expect(source).not.toContain('autoFocus')
  })
})

describe('BoardFeed — ranking/cursor contract untouched: the exact same request shape as before this checkpoint', () => {
  it('still calls getBoardFeedPage with sessionStartedAt/seed/cursor/limit only — no new/renamed parameters', () => {
    const body = loadMoreBody()
    expect(body).toContain('getBoardFeedPage(supabase, {')
    expect(body).toContain('sessionStartedAt,')
    expect(body).toContain('seed,')
    expect(body).toContain('limit: pageSize,')
  })

  it('never imports or references board ranking/Reading Trail internals beyond the existing readingTrailSearchParams re-export', () => {
    expect(source).not.toContain('rank_key')
    expect(source).not.toContain('seed_hash')
    expect(source).not.toContain('seen_bucket')
  })
})
