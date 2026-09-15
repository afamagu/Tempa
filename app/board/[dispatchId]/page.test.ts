// Dispatch detail page is an async Server Component with heavy Supabase
// dependency — not practically renderable via this codebase's own
// renderToStaticMarkup-only convention. The Continue Reading shelf
// (Home Phase 1B, part C) is instead verified via direct inspection of
// the tracked source text, the same convention app/home/page.test.ts
// already established. The underlying data logic (getNextTrailItems
// returning the right rows in the right order, per-item cursor
// correctness when picking a non-first recommendation) is already
// covered thoroughly by lib/dispatches.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const PAGE_PATH = path.join(__dirname, 'page.tsx')
const source = readFileSync(PAGE_PATH, 'utf8')

// JSX block comments stripped as whole blocks (non-greedy, across
// newlines) — a line-prefix filter alone misses continuation lines of
// a `{/* ... */}` comment, which carry no per-line marker.
const executable = source.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const executableLower = executable.toLowerCase()

describe('Dispatch detail page — Continue Reading shelf (Home Phase 1B)', () => {
  it('is gated on continueReadingCards.length > 0 — no items, no section', () => {
    expect(source).toContain('{continueReadingCards.length > 0 && (')
  })

  it('sits after RepliesSection and before the bottom-of-page "Back to The Board" link', () => {
    const replies = source.indexOf('<RepliesSection')
    const shelf = source.indexOf('{continueReadingCards.length > 0 && (')
    const backLink = source.indexOf('Bottom-of-letter return nav')
    expect(replies).toBeGreaterThan(-1)
    expect(shelf).toBeGreaterThan(replies)
    expect(backLink).toBeGreaterThan(shelf)
  })

  it('uses the shared BoardShelfCard primitive with size="continue", never a bespoke card', () => {
    const shelfBlockStart = source.indexOf('{continueReadingCards.length > 0 && (')
    const shelfBlockEnd = source.indexOf('Bottom-of-letter return nav', shelfBlockStart)
    const block = source.slice(shelfBlockStart, shelfBlockEnd)
    expect(block).toContain('<BoardShelfCard')
    expect(block).toContain('size="continue"')
  })

  // Home Phase 1C — desktop widened from a cramped 3-per-row rail to 2
  // comfortably-sized cards, so pseudonym/title/excerpt have room; the
  // mobile scroll-snap shape (w-[85%] peek) is unchanged from Phase 1B.
  it('mobile uses native horizontal scroll-snap (no carousel library) and desktop uses a calm 2-column grid', () => {
    expect(source).toContain(
      'no-scrollbar mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0'
    )
    expect(source).toContain('w-[85%] shrink-0 snap-start sm:w-auto sm:shrink')
  })

  it('never introduces auto-advance, dots, arrows, or a "1 of N" pagination affordance', () => {
    expect(executableLower).not.toContain('auto-advance')
    expect(executableLower).not.toContain('autoadvance')
    expect(executableLower).not.toMatch(/\d\s*of\s*\d/)
    expect(executable).not.toMatch(/setInterval/)
  })

  it('carries the same session plus each item\'s own cursor via readingTrailSearchParams — never the original item\'s cursor for every card', () => {
    expect(source).toContain('nextTrailItems.map((item) => ({')
    expect(source).toContain('trailQuery: readingTrailSearchParams(')
    expect(source).toContain('{ sessionStartedAt: trailContext.sessionStartedAt, seed: trailContext.seed },')
    const paramsCallStart = source.indexOf('trailQuery: readingTrailSearchParams(')
    const paramsCallEnd = source.indexOf(').toString()', paramsCallStart)
    const paramsCall = source.slice(paramsCallStart, paramsCallEnd)
    expect(paramsCall.trim().endsWith('item')).toBe(true)
  })

  it('fetches nextTrailItems only when trailContext exists — direct/shared URLs (no trail params) get an empty array, not an error', () => {
    expect(source).toContain('trailContext ? getNextTrailItems(supabase, trailContext, dispatch.id) : Promise.resolve([])')
  })

  it('never renders a visible count/popularity label inside the shelf', () => {
    const shelfBlockStart = executable.indexOf('{continueReadingCards.length > 0 && (')
    const shelfBlockEnd = executable.indexOf('Bottom-of-letter return nav', shelfBlockStart)
    const block = executable.slice(shelfBlockStart, shelfBlockEnd)
    expect(block).not.toMatch(/worth\s*reading/i)
  })

  // Dispatch Postcards Checkpoint 2 — the section label is now "Read
  // next," copy-only, no behavior/layout/trail change (all the shelf
  // assertions above still pass unmodified).
  it('labels the shelf "Read next" — the old "Continue reading" label is gone', () => {
    expect(source).toContain('sectionLabelClass}>Read next')
    expect(source).not.toMatch(/>continue reading</i)
  })
})

describe('Dispatch detail page — attached Postcard (Checkpoint 2)', () => {
  it('fetches the Postcard once, alongside every other per-view data fetch', () => {
    expect(source).toContain('getDispatchPostcard(supabase, dispatch.id)')
  })

  it('renders nothing when there is no attached Postcard', () => {
    expect(source).toContain('{postcard && (')
  })

  it('reuses LetterheadPostcard directly — no bespoke Postcard rendering', () => {
    const start = source.indexOf('{postcard && (')
    const end = source.indexOf('<div className="rounded-md bg-surface-shell p-4 sm:p-6">', start)
    const block = source.slice(start, end)
    expect(block).toContain('<LetterheadPostcard')
    expect(block).toContain('dispatchPostcardToBaseContent(postcard.version)')
  })

  it('sits with the Dispatch header/body content, above the reader', () => {
    const title = source.indexOf('<h1 className={sectionTitleClass}>')
    const postcardBlock = source.indexOf('{postcard && (')
    const reader = source.indexOf('<DispatchReader')
    expect(title).toBeGreaterThan(-1)
    expect(postcardBlock).toBeGreaterThan(title)
    expect(postcardBlock).toBeLessThan(reader)
  })
})
