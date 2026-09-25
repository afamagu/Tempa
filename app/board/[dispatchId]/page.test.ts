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

function sourceBlock(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker)
  expect(start, `missing start marker: ${startMarker}`).toBeGreaterThanOrEqual(0)
  const end = text.indexOf(endMarker, start)
  expect(end, `missing end marker after ${startMarker}: ${endMarker}`).toBeGreaterThan(start)
  return text.slice(start, end)
}

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

describe('Dispatch detail page — Correspondence Entry Point checkpoint', () => {
  const actionRowMarker = '<div className="flex items-center justify-between gap-3">'
  const actionRowEndMarker = '<div className="border-t border-foreground/10" />'

  function actionRow(text = source) {
    return sourceBlock(text, actionRowMarker, actionRowEndMarker)
  }

  it('reuses the EXISTING correspondence contract — canWriteToMind imported from the profile page, never redefined here', () => {
    expect(source).toContain("import { canWriteToMind } from '@/app/minds/[userId]/page'")
    // No second/local definition — exactly one function declaration
    // named canWriteToMind anywhere in this file (the import itself).
    expect(source).not.toMatch(/function\s+canWriteToMind/)
  })

  it('reuses the EXISTING data sources (getMyAnswers, getActiveCorrespondencePartnerIds, getContactedAnswerIds) — no new query/RPC invented for this', () => {
    expect(source).toContain("import { getMyAnswers } from '@/lib/questions'")
    expect(source).toContain('getActiveCorrespondencePartnerIds')
    expect(source).toContain('getContactedAnswerIds')
    expect(source).toContain('getMyAnswers(supabase, dispatch.authorId)')
  })

  it('the author\'s own view never fetches any of this — isAuthor short-circuits to empty answers/empty Sets', () => {
    expect(source).toContain('isAuthor || !isMemberDispatch ? Promise.resolve([]) : getMyAnswers(supabase, dispatch.authorId)')
    expect(source).toContain(
      "isAuthor || !isMemberDispatch ? Promise.resolve(new Set<string>()) : getActiveCorrespondencePartnerIds(supabase, user.id)"
    )
    expect(source).toContain(
      "isAuthor || !isMemberDispatch ? Promise.resolve(new Set<string>()) : getContactedAnswerIds(supabase, user.id)"
    )
  })

  it('3. never offered to write to yourself: isSelf is bound to isAuthor, and the whole block is gated on !isAuthor', () => {
    expect(source).toContain('isSelf: isAuthor,')
    const readerEnd = source.indexOf('initialPosition={initialPosition}')
    const nonAuthorGate = source.indexOf('{!isAuthor && (', readerEnd)
    const row = source.indexOf(actionRowMarker, readerEnd)
    expect(readerEnd).toBeGreaterThanOrEqual(0)
    expect(nonAuthorGate).toBeGreaterThan(readerEnd)
    expect(row).toBeGreaterThan(nonAuthorGate)
  })

  it('1/2. routes into the EXISTING private-write destination, the exact same href shape the profile page uses — never a new writing flow', () => {
    expect(source).toContain('href={`/write/${dispatch.authorId}?a=${authorPrimaryAnswer.id}`}')
  })

  it('already-corresponding preserves the existing product behavior — routes to /letters, exactly like the profile page\'s own "Open your correspondence"', () => {
    expect(source).toContain('<Link href="/letters" className={quietLinkClass}>')
    expect(source).toContain('Open your correspondence')
  })

  it('the exact approved copy "Write to this mind" is used', () => {
    expect(source).toContain('Write to this mind')
  })

  it('uses the restrained quietLinkClass text-link treatment, never primaryButtonClass/secondaryButtonClass — visually subordinate, never a conversion button', () => {
    const block = actionRow(executable)
    expect(block).toContain('quietLinkClass')
    expect(block).not.toContain('primaryButtonClass')
    expect(block).not.toContain('secondaryButtonClass')
  })

  it('4. existing writer identity/profile navigation is untouched — still links to /minds/[authorId]', () => {
    expect(source).toContain('href={`/minds/${dispatch.authorId}`}')
  })

  it('places Worth Reading first/left and Write/Open second/right in one deliberate action row', () => {
    const block = actionRow()
    const worthReading = block.indexOf('<WorthReadingButton')
    const entryPoint = block.indexOf('{(showWriteToAuthor || alreadyCorrespondingWithAuthor) &&')
    expect(worthReading).toBeGreaterThanOrEqual(0)
    expect(entryPoint).toBeGreaterThan(worthReading)
    expect(block).toContain('justify-between')
    expect(block).toContain('text-right')
    expect(block).not.toContain('flex-wrap')
  })

  it('keeps Replies outside and after the complete action row, with a divider creating its own visual space', () => {
    const rowStart = source.indexOf(actionRowMarker)
    const rowEnd = source.indexOf(actionRowEndMarker, rowStart)
    const replies = source.indexOf('<RepliesSection', rowEnd)
    expect(rowStart).toBeGreaterThanOrEqual(0)
    expect(rowEnd).toBeGreaterThan(rowStart)
    expect(replies).toBeGreaterThan(rowEnd)
    expect(actionRow()).not.toContain('<RepliesSection')
  })

  it('removes the obsolete standalone correspondence block immediately above Replies', () => {
    expect(source).not.toContain('{!isAuthor && (showWriteToAuthor || alreadyCorrespondingWithAuthor) && (')
    const betweenRowAndReplies = sourceBlock(source, actionRowEndMarker, '<RepliesSection')
    expect(betweenRowAndReplies).not.toContain('Write to this mind')
    expect(betweenRowAndReplies).not.toContain('Open your correspondence')
  })

  it('5. no engagement toolbar was introduced by this checkpoint — no Like/Comment/Follow/reaction/count word anywhere in the new block itself', () => {
    // Scoped to exactly the new block, not the whole file — the file
    // already legitimately contains unrelated prose using some of these
    // words elsewhere (e.g. an existing comment reading "like Keep in
    // Mind"), which a whole-file check would wrongly flag.
    const block = actionRow(executable).toLowerCase()
    expect(block).not.toMatch(/\blike\b/)
    expect(block).not.toMatch(/\bfollow(ing|er)?\b/)
    expect(block).not.toContain('reaction')
    expect(block).not.toContain('comment')
    expect(block).not.toMatch(/\bcount\b/)
  })

  it('7. no fixed/sticky/floating CTA — an ordinary in-flow block, safe alongside AppShell\'s mobile bottom nav', () => {
    const block = actionRow(executable)
    expect(block).not.toContain('fixed')
    expect(block).not.toContain('sticky')
    expect(block).not.toMatch(/floating/i)
  })

  it('8. no relationship classification label ("Correspondent", "Blocked", etc.) leaks into the Dispatch UI', () => {
    const block = actionRow(executable)
    expect(block).not.toMatch(/correspondent/i)
    expect(block).not.toMatch(/blocked/i)
    expect(block).not.toMatch(/stop letters/i)
  })

  it('does not duplicate blocking/Stop Letters checks locally — delegates entirely to the existing profile/write flow, matching that flow\'s own established defense-in-depth pattern', () => {
    const block = actionRow()
    expect(block).not.toContain('is_blocked_pair')
    expect(block).not.toContain('is_correspondence_blocked_pair')
    expect(block).not.toContain('getBlockScope')
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
