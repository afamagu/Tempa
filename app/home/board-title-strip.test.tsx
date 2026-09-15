import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import BoardTitleStrip from './board-title-strip'

const ITEMS = [
  { id: 'd-1', title: 'A quiet morning ritual', href: '/board/d-1?s=2026-09-01T00%3A00%3A00Z&seed=a&tier=2&aseq=1&shash=1' },
  { id: 'd-2', title: 'Letters from the coast', href: '/board/d-2?s=2026-09-01T00%3A00%3A00Z&seed=a&tier=2&aseq=2&shash=2' },
  { id: 'd-3', title: 'A recipe for slow evenings', href: '/board/d-3?s=2026-09-01T00%3A00%3A00Z&seed=a&tier=3&aseq=1&shash=3' },
]

// This codebase's own test convention is renderToStaticMarkup only, no
// jsdom (see vitest.config.ts: environment 'node') — so the actual
// setInterval cycling and the live prefers-reduced-motion media-query
// read can't be exercised here (both only ever run client-side, after
// mount). What IS genuinely testable via a static render: the INITIAL
// state's structure — which item starts visible/reachable, that every
// other item is inert, and that the component never uses an aria-live
// region (the one accessibility property that must hold true
// regardless of which branch the client-only motion logic takes).
describe('BoardTitleStrip — ambient discovery strip, not primary navigation', () => {
  it('renders nothing at all when there are no items', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={[]} />)
    expect(html).toBe('')
  })

  it('renders every item as a real, ordinary accessible link', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={ITEMS} />)
    for (const item of ITEMS) {
      expect(html).toContain(`href="${item.href.replace(/&/g, '&amp;')}"`)
      expect(html).toContain(item.title)
    }
  })

  it('only the first item starts visible and reachable by keyboard; every other item is inert', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={ITEMS} />)
    const firstIndex = html.indexOf(ITEMS[0].href.replace(/&/g, '&amp;'))
    const firstTagStart = html.lastIndexOf('<a', firstIndex)
    const firstTagEnd = html.indexOf('>', firstTagStart)
    const firstTag = html.slice(firstTagStart, firstTagEnd)
    expect(firstTag).toContain('aria-hidden="false"')
    expect(firstTag).toContain('tabindex="0"')
    expect(firstTag).toContain('opacity-100')

    for (const item of ITEMS.slice(1)) {
      const idx = html.indexOf(item.href.replace(/&/g, '&amp;'))
      const tagStart = html.lastIndexOf('<a', idx)
      const tagEnd = html.indexOf('>', tagStart)
      const tag = html.slice(tagStart, tagEnd)
      expect(tag).toContain('aria-hidden="true"')
      expect(tag).toContain('tabindex="-1"')
      expect(tag).toContain('opacity-0')
      expect(tag).toContain('pointer-events-none')
    }
  })

  it('never uses an aria-live region — automatic cycling must never be announced to assistive tech', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={ITEMS} />)
    expect(html).not.toContain('aria-live')
  })

  it('is never a modal/dialog and carries no marquee/ticker/slide vocabulary', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={ITEMS} />)
    const lower = html.toLowerCase()
    expect(lower).not.toContain('marquee')
    expect(lower).not.toContain('ticker')
    expect(lower).not.toContain('role="dialog"')
  })

  it('renders a fixed-height container, never a height that would jump between items', () => {
    const html = renderToStaticMarkup(<BoardTitleStrip items={ITEMS} />)
    expect(html).toMatch(/^<div class="[^"]*\bh-6\b[^"]*"/)
  })
})
