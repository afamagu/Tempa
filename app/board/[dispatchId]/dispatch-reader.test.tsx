import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DispatchReader from './dispatch-reader'

const SOURCE_PATH = path.join(__dirname, 'dispatch-reader.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// Static render only — same convention as letter-reader.test.tsx (see
// its own header comment). The Saved-place round trip itself (save,
// move, remove, and its independence from automatic resume) is
// exhaustively covered at the pure-logic level in
// lib/reading-places.test.ts, which this reader now uses with
// contentType: 'dispatch' — this file only proves the control renders.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))

// The reader must never grow swipe-based navigation — no "Up next", no
// next-Dispatch machinery, no swipe/carousel vocabulary anywhere in
// its rendered output. This is a structural guard, not a UI-copy
// preference: the product spec explicitly forbids Reels/Stories-style
// consumption here.
describe('DispatchReader — no swipe-navigation machinery', () => {
  it('renders the body without any swipe/carousel/next-Dispatch affordance', () => {
    const html = renderToStaticMarkup(
      <DispatchReader
        viewerId="viewer-1"
        dispatchId="dispatch-1"
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[]}
        initialPosition={0}
      />
    )
    const lower = html.toLowerCase()
    expect(lower).not.toContain('swipe')
    expect(lower).not.toContain('up next')
    expect(lower).not.toContain('next dispatch')
    expect(lower).not.toContain('carousel')
  })

  it('tags each paragraph with a stable data-paragraph-index for the resume-position tracker', () => {
    const html = renderToStaticMarkup(
      <DispatchReader
        viewerId="viewer-1"
        dispatchId="dispatch-1"
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[]}
        initialPosition={0}
      />
    )
    expect(html).toContain('data-paragraph-index="0"')
    expect(html).toContain('data-paragraph-index="1"')
  })

  it('renders the "Save my place" action, same deliberate-place control as the Letter reader', () => {
    const html = renderToStaticMarkup(
      <DispatchReader
        viewerId="viewer-1"
        dispatchId="dispatch-1"
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[]}
        initialPosition={0}
      />
    )
    expect(html).toContain('Save my place')
    // Nothing has been saved yet on this static render (no effect has
    // run), so the "already saved" controls must not appear alongside it.
    expect(html).not.toContain('Move my place')
  })
})

// Structural source proof (same convention as page.test.ts's own
// initialPosition wiring check) for the independent audit correction:
// reading_places, not dispatch_views' own forward-only tracker, must be
// what decides where the reader visibly resumes, with initialPosition
// demoted to a fallback-only role. Interactive behavior itself (the
// actual scroll/measurement) is a live-test item, same status as the
// IntersectionObserver-driven dispatch_views tracker it sits beside —
// the underlying "no ratchet" algorithm is exhaustively proven at the
// pure-logic level by lib/reading-places.test.ts's own
// pickCurrentParagraph suite, which both readers share.
describe('DispatchReader — reading_places is authoritative for resume, dispatch_views is fallback-only (independent audit correction)', () => {
  it('scrolls via scrollToAnchor using reading_places\' own resume state when a row exists', () => {
    expect(source).toContain('scrollToAnchor(container, scrollRoot, state.resumeParagraphIndex, state.resumeCharOffset')
  })

  it('falls back to dispatch_views\' initialPosition only inside the branch where no reading_places resume row exists yet', () => {
    const elseBranch = source.slice(source.indexOf('} else {', source.indexOf('state.resumeParagraphIndex !== null')))
    expect(elseBranch.slice(0, 200)).toContain('clampReadingPosition(initialPosition, paragraphCount)')
  })

  it('still calls recordDispatchProgress on the same triggers as before — dispatch_views itself is untouched', () => {
    expect(source).toContain('void recordDispatchProgress(supabase, viewerId, dispatchId, savedRef.current)')
    expect(source).toContain('void recordDispatchProgress(supabase, viewerId, dispatchId, lastPassedRef.current)')
  })

  it('re-measures the current reading position fresh via getCurrentReadingAnchor for the periodic/unmount reading_places save, never trusting a ratchet', () => {
    expect(source).toContain('const anchor = getCurrentReadingAnchor(container, scrollRoot)')
    expect(source).not.toMatch(/resumeAnchorRef\.current\s*=\s*lastPassedRef/)
  })

  it('positions the ribbon using both the saved paragraph index and its char offset, not offsetTop alone', () => {
    expect(source).toContain('savedCharOffset !== null ? estimateScrollFraction(savedCharOffset, text.length) : 0')
    expect(source).toContain('target.offsetTop + fraction * target.offsetHeight')
    expect(source).toMatch(/\[savedParagraphIndex, savedCharOffset, ribbonReady, body\]/)
  })
})
