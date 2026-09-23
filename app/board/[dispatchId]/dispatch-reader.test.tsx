import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchReader from './dispatch-reader'

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
