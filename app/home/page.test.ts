// Home's page.tsx is an async Server Component with heavy Supabase
// dependency — not practically renderable via this codebase's own
// renderToStaticMarkup-only convention. Its section ORDER is instead
// verified the same way this codebase already verifies structural
// properties of non-trivially-renderable files (SQL migrations): direct
// inspection of the tracked source text. The underlying data logic
// (partitioning, no cross-section duplication, degrade-gracefully
// behavior) is already covered thoroughly by lib/dispatches.test.ts's
// own partitionHomeSections suite — this file only proves RENDER ORDER,
// which lives in page.tsx itself, not in that pure function.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PAGE_PATH = path.join(__dirname, 'page.tsx')
const source = readFileSync(PAGE_PATH, 'utf8')

// Section markers, in the exact order the Home Phase 1B hierarchy
// requires. Each is a substring unique to that section's own JSX (a
// label string or a component reference), found via indexOf so ordering
// is proven directly from the tracked source.
const MARKERS = {
  arrivals: "pageTitleClass}>Arrivals",
  mailOnTheWay: 'title="Mail on the way"',
  questionIncomplete: '<QuestionIncompleteNotice />',
  fromTheBoard: 'sectionLabelClass}>From the Board',
  fromMindsYouKeep: 'sectionLabelClass}>From Minds You Keep',
  recommendedMinds: 'sectionLabelClass}>Recommended minds',
  serendipity: 'sectionLabelClass}>A Little Serendipity',
  announcement: '<AnnouncementTeaser',
}

function indexOfMarker(key: keyof typeof MARKERS): number {
  const index = source.indexOf(MARKERS[key])
  expect(index, `expected to find marker for "${key}" in app/home/page.tsx`).toBeGreaterThan(-1)
  return index
}

describe('Home Phase 1B — rendered section order', () => {
  it('renders the personal/attention group first, in order: Arrivals, Mail on the way, QuestionIncompleteNotice', () => {
    const arrivals = indexOfMarker('arrivals')
    const mail = indexOfMarker('mailOnTheWay')
    const question = indexOfMarker('questionIncomplete')
    expect(arrivals).toBeLessThan(mail)
    expect(mail).toBeLessThan(question)
  })

  it('renders Featured Board (From the Board) immediately after the personal/attention group', () => {
    const question = indexOfMarker('questionIncomplete')
    const board = indexOfMarker('fromTheBoard')
    expect(question).toBeLessThan(board)
  })

  it('renders the simplified reading order: From the Board, From Minds You Keep, Recommended minds, A Little Serendipity', () => {
    const board = indexOfMarker('fromTheBoard')
    const keep = indexOfMarker('fromMindsYouKeep')
    const recommended = indexOfMarker('recommendedMinds')
    const serendipity = indexOfMarker('serendipity')
    expect(board).toBeLessThan(keep)
    expect(keep).toBeLessThan(recommended)
    expect(recommended).toBeLessThan(serendipity)
  })

  it('Recommended Minds sits between From Minds You Keep and A Little Serendipity', () => {
    const keep = indexOfMarker('fromMindsYouKeep')
    const recommended = indexOfMarker('recommendedMinds')
    const serendipity = indexOfMarker('serendipity')
    expect(recommended).toBeGreaterThan(keep)
    expect(recommended).toBeLessThan(serendipity)
  })

  it('renders the ordinary Announcement teaser LAST — after every discovery/reading section', () => {
    const serendipity = indexOfMarker('serendipity')
    const announcement = indexOfMarker('announcement')
    expect(announcement).toBeGreaterThan(serendipity)
  })

  it('does not repeat Board material under generic Reading Shelf or ambient-strip labels', () => {
    expect(source).not.toContain('Your Reading Shelf')
    expect(source).not.toContain('>On the Board<')
    expect(source).not.toContain('<BoardTitleStrip')
  })

  it('renders kept writing through the compact identity-and-title shelf', () => {
    expect(source).toContain('<KeptDispatchShelf dispatches={fromMindsYouKeep} trailQueryFor={trailQueryFor} />')
  })
})

describe('Home Phase 1B — omission/degradation behavior preserved', () => {
  it('From Minds You Keep is still gated on fromMindsYouKeep.length > 0 (omits cleanly when empty)', () => {
    const start = source.indexOf(MARKERS.fromMindsYouKeep)
    const before = source.slice(0, start)
    const guardIndex = before.lastIndexOf('{fromMindsYouKeep.length > 0 && (')
    expect(guardIndex).toBeGreaterThan(-1)
  })

  it('A Little Serendipity is still gated on serendipity.length > 0', () => {
    const start = source.indexOf(MARKERS.serendipity)
    const before = source.slice(0, start)
    const guardIndex = before.lastIndexOf('{serendipity.length > 0 && (')
    expect(guardIndex).toBeGreaterThan(-1)
  })

  it('Recommended Minds still renders regardless of the Board candidate pool — the wide wrapper is guarded on EITHER pool being non-empty', () => {
    expect(source).toContain('(boardItems.length > 0 || recommended.length > 0)')
  })

  it('the Announcement is still gated on activeAnnouncement — no Announcement, no section rendered', () => {
    const start = source.indexOf(MARKERS.announcement)
    const before = source.slice(0, start)
    const guardIndex = before.lastIndexOf('{activeAnnouncement && (')
    expect(guardIndex).toBeGreaterThan(-1)
  })

  it('never introduces a new urgency concept for AnnouncementTeaser — no new prop threaded beyond announcement/imageUrl', () => {
    const start = source.indexOf(MARKERS.announcement)
    const end = source.indexOf('/>', start)
    const usage = source.slice(start, end)
    expect(usage).toContain('announcement={activeAnnouncement}')
    expect(usage).toContain('imageUrl={announcementImageUrl}')
    expect(usage).not.toMatch(/urgent|priority|pinned/i)
  })
})

describe('Home Arrivals — unread-letter source of truth', () => {
  it('derives one unread-arrival collection after hidden correspondences are removed', () => {
    expect(source).toContain('const allLetters = excludeHiddenLetters(allLettersRaw, hiddenCorrespondenceIds)')
    expect(source).toContain('const awaitingReply = deriveArrivals(allLetters, user.id)')
  })

  it('uses that same collection for the displayed count, single-letter destination, sender, and preview', () => {
    expect(source).toContain('const singleAwaiting = awaitingReply.length === 1 ? awaitingReply[0] : null')
    expect(source).toContain('{awaitingReply.length > 0 ? (')
    expect(source).toContain("awaitingReply.length === 1")
    expect(source).toContain('`${awaitingReply.length} letters waiting`')
    expect(source).toContain('letterPreviewText(singleAwaiting.body)')
  })

  it('does not determine the Home waiting card from sent lifecycle status', () => {
    const deriveStart = source.indexOf('const awaitingReply = deriveArrivals(allLetters, user.id)')
    const arrivalsRenderEnd = source.indexOf('{mailOnTheWay && (', deriveStart)
    expect(deriveStart).toBeGreaterThan(-1)
    expect(arrivalsRenderEnd).toBeGreaterThan(deriveStart)
    expect(source.slice(deriveStart, arrivalsRenderEnd)).not.toMatch(/status\s*===?\s*['"]sent['"]/)
  })

  it('preserves the existing navigation unread-count query independently', () => {
    expect(source).toContain('getWaitingLetterCount(supabase, user.id)')
    expect(source).toContain('<AppShell active="home" waitingLetterCount={waitingCount}>')
  })
})

describe('Home Phase 1 (regression) — no infinite feed, no popularity metrics', () => {
  // Comment-stripped — this codebase's own established convention — so
  // a doc comment explicitly EXPLAINING an absence ("This is NOT an
  // infinite feed... no 'load more' here") isn't mistaken for the very
  // thing it forbids. JSX block comments (`{/* ... */}`) span multiple
  // lines with no per-line marker, so they're stripped as whole blocks
  // (non-greedy, across newlines) rather than line-by-line.
  const executable = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const executableLower = executable.toLowerCase()

  it('never introduces a "load more"/pagination affordance on Home', () => {
    expect(executableLower).not.toContain('load more')
    expect(executableLower).not.toContain('infinite')
  })

  it('never renders a visible count/popularity label anywhere in the Board reading surface', () => {
    expect(executable).not.toMatch(/worth\s*reading/i)
  })
})

describe('Home premium composition — visual competition removed', () => {
  it('does not fetch or thread first-Moment thumbnails into Home cards', () => {
    expect(source).not.toContain('getFirstMomentThumbnails')
    expect(source).not.toContain('thumbnailUrl=')
  })
})
