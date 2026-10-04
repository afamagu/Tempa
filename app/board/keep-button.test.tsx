import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KeepButton from './keep-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

describe('KeepButton — wording', () => {
  it('unselected label names the person being kept', () => {
    const html = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    expect(html).toContain('Keep Evening Quill')
    expect(html).not.toMatch(/>Keep</)
  })

  it('selected label is Kept, with no retired mind terminology', () => {
    const html = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    expect(html).toContain('>Kept<')
    expect(html.toLowerCase()).not.toContain('in mind')
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

  it('the accessible name identifies the person without mind terminology', () => {
    const unselected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    const selected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    expect(unselected).toMatch(/aria-label="Keep Evening Quill"/)
    expect(selected).toMatch(/aria-label="Kept Evening Quill — tap to remove"/)
  })
})

describe('KeepButton — stable width regardless of toggle state', () => {
  it('renders both possible labels in both states, with exactly one marked invisible', () => {
    const unselected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept={false} />
    )
    const selected = renderToStaticMarkup(
      <KeepButton viewerId="viewer-1" keptUserId="author-1" keptPseudonym="Evening Quill" initiallyKept />
    )
    for (const html of [unselected, selected]) {
      expect(html).toContain('Kept')
      expect(html).toContain('Keep Evening Quill')
      expect((html.match(/invisible/g) ?? []).length).toBe(1)
    }
  })
})
