import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterReader from './letter-reader'

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
