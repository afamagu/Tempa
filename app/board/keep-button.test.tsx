import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KeepButton from './keep-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

// Board usability checkpoint (2026-09-09): the unselected label must
// name the PERSON being kept ("Keep Evening Quill"), never a bare
// "Keep" that could be misread as saving the Dispatch itself. Keep in
// Mind is a relationship to a person, not to a piece of writing.
describe('KeepButton — wording (item 4)', () => {
  it('unselected label is "Keep <pseudonym>", not a bare "Keep"', () => {
    const html = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    expect(html).toContain('Keep Evening Quill')
    expect(html).not.toMatch(/>Keep</)
  })

  it('selected label remains exactly "In mind"', () => {
    const html = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    expect(html).toContain('>In mind<')
  })

  it('never uses Follow/Subscribe/Watch/Favourite/Heart vocabulary', () => {
    const unselected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    const selected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    for (const html of [unselected, selected]) {
      const lower = html.toLowerCase()
      expect(lower).not.toContain('follow')
      expect(lower).not.toContain('subscribe')
      expect(lower).not.toContain('watch')
      expect(lower).not.toContain('favourite')
      expect(lower).not.toContain('favorite')
      expect(lower).not.toContain('heart')
    }
  })

  it('the accessible name identifies the person, not the Dispatch', () => {
    const html = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    expect(html).toMatch(/aria-label="Keep Evening Quill in mind"/)
  })
})

// Board live-test corrections (2026-09-10): toggling Keep must never
// shift the surrounding layout — both possible labels are stacked in
// the same CSS grid cell so the control always reserves the wider of
// the two, with only one ever visually shown.
describe('KeepButton — stable width regardless of toggle state (layout-shift fix)', () => {
  it('renders both possible labels in both states, with exactly one marked invisible', () => {
    const unselected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    const selected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    for (const html of [unselected, selected]) {
      expect(html).toContain('In mind')
      expect(html).toContain('Keep Evening Quill')
      expect((html.match(/invisible/g) ?? []).length).toBe(1)
    }
  })
})
