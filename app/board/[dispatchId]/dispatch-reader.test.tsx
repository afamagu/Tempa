import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchReader from './dispatch-reader'

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
})
