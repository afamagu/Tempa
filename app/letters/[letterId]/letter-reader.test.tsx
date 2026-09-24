import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import LetterReader from './letter-reader'

const source = readFileSync(path.join(__dirname, 'letter-reader.tsx'), 'utf8')

// Static render only — this codebase's established Vitest convention
// has no DOM-mounting/simulated-scroll library (see dispatch-
// reader.test.tsx's own header comment, the exact precedent this file
// follows). getReadingPlaceState/recordReadingProgress/
// saveReadingPlace/removeSavedReadingPlace's own round-trip behavior
// (independence of automatic resume vs. deliberate Saved place, per-
// member/per-content isolation) is exhaustively covered at the pure-
// logic level in lib/reading-places.test.ts instead; the
// IntersectionObserver-driven tracking itself is a live-test item, same
// as DispatchReader's.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))

describe('LetterReader — tags each paragraph for the resume-position tracker', () => {
  it('tags each paragraph with a stable data-paragraph-index, same convention as DispatchReader', () => {
    const html = renderToStaticMarkup(
      <LetterReader viewerId="viewer-1" letterId="letter-1" body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).toContain('data-paragraph-index="0"')
    expect(html).toContain('data-paragraph-index="1"')
  })

  it('renders the "Save my place" action before any place has been saved', () => {
    const html = renderToStaticMarkup(
      <LetterReader viewerId="viewer-1" letterId="letter-1" body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).toContain('Save my place')
    // Nothing has been saved yet on this render (no effect has run in
    // a static render), so the "already saved" controls must not
    // appear alongside it.
    expect(html).not.toContain('Move my place')
  })

  it('never renders raw pixel-offset vocabulary — the anchor is always paragraph-based', () => {
    const html = renderToStaticMarkup(
      <LetterReader viewerId="viewer-1" letterId="letter-1" body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html.toLowerCase()).not.toContain('scrolltop')
    expect(html.toLowerCase()).not.toContain('pixel')
  })
})

describe('LetterReader — ribbon positioning uses the saved char offset, not paragraph top alone (independent audit correction)', () => {
  it('computes the ribbon top from both the paragraph\'s offsetTop and the estimated fraction of the saved char offset', () => {
    expect(source).toContain('savedCharOffset !== null ? estimateScrollFraction(savedCharOffset, text.length) : 0')
    expect(source).toContain('target.offsetTop + fraction * target.offsetHeight')
  })

  it('re-runs the ribbon-positioning effect whenever savedCharOffset changes, not only the paragraph index', () => {
    expect(source).toMatch(/\[savedParagraphIndex, savedCharOffset, ready, body\]/)
  })
})
