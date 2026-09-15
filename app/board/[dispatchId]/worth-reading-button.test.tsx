import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorthReadingButton from './worth-reading-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

describe('WorthReadingButton — quiet text control, no count/badge', () => {
  it('unselected label reads exactly "Worth reading"', () => {
    const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={false} />)
    expect(html).toContain('>Worth reading<')
  })

  it('selected label reads "✓ Worth reading"', () => {
    const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked />)
    expect(html).toContain('✓ Worth reading')
  })

  it('never renders a numeric count in its visible text, in either state', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      const visibleText = html.replace(/<[^>]*>/g, '')
      expect(visibleText).not.toMatch(/\d/)
    }
  })

  it('never uses like/heart/vote/react vocabulary', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      const lower = html.toLowerCase()
      expect(lower).not.toContain('like')
      expect(lower).not.toContain('heart')
      expect(lower).not.toContain('vote')
      expect(lower).not.toContain('react')
    }
  })

  it('exposes aria-pressed reflecting the current state', () => {
    const unselected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={false} />)
    const selected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked />)
    expect(unselected).toContain('aria-pressed="false"')
    expect(selected).toContain('aria-pressed="true"')
  })

  it('is a single real button, not a modal/panel/large CTA', () => {
    const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={false} />)
    expect((html.match(/<button/g) ?? []).length).toBe(1)
    expect(html.toLowerCase()).not.toContain('modal')
  })
})
