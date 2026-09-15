import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WorthReadingButton from './worth-reading-button'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

describe('WorthReadingButton — framed TEMPA plaque, no count/badge/icon', () => {
  it('label reads exactly "WORTH READING" in both states, never lowercase or checkmarked', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      const visibleText = html.replace(/<[^>]*>/g, '')
      expect(visibleText).toBe('WORTH READING')
      expect(visibleText).not.toContain('✓')
    }
  })

  it('never renders a numeric count in its visible text, in either state', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      const visibleText = html.replace(/<[^>]*>/g, '')
      expect(visibleText).not.toMatch(/\d/)
    }
  })

  it('never uses like/heart/vote/react vocabulary, and never a checkmark/star/thumb/upvote icon', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      const lower = html.toLowerCase()
      expect(lower).not.toContain('like')
      expect(lower).not.toContain('heart')
      expect(lower).not.toContain('vote')
      expect(lower).not.toContain('react')
      expect(lower).not.toContain('star')
      expect(lower).not.toContain('thumb')
      expect(html).not.toContain('✓')
      expect(html).not.toContain('★')
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

  it('is a framed rectangular plaque — a real border, rounded-md corners, never a pill (rounded-full)', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      expect(html).toMatch(/\brounded-md\b/)
      expect(html).toMatch(/\bborder\b/)
      // rounded-full would appear only on the decorative pilot-light dot,
      // never on the button's own frame.
      const buttonOpenTag = html.match(/^<button[^>]*>/)?.[0] ?? ''
      expect(buttonOpenTag).not.toMatch(/rounded-full/)
    }
  })

  it('uses the verdigris token, not the general accent/clay tokens, for its border/interior/text', () => {
    for (const marked of [false, true]) {
      const html = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={marked} />)
      expect(html).toMatch(/verdigris/)
    }
  })

  it('the selected state has a stronger verdigris border/text and a restrained halo than the dormant state', () => {
    const unselected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={false} />)
    const selected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked />)
    expect(unselected).not.toContain('text-verdigris')
    expect(selected).toContain('text-verdigris')
    expect(selected).toContain('shadow-')
    expect(unselected).not.toContain('shadow-')
  })

  it('renders a decorative pilot-light dot, hollow when dormant and filled when selected', () => {
    const unselected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked={false} />)
    const selected = renderToStaticMarkup(<WorthReadingButton dispatchId="d-1" initiallyMarked />)
    expect(unselected).toMatch(/<span aria-hidden="true"[^>]*border[^>]*><\/span>/)
    expect(selected).toMatch(/<span aria-hidden="true"[^>]*bg-verdigris[^>]*><\/span>/)
  })
})
