import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TempaEmblem from './tempa-emblem'

// Brand asset correction (2026-09-24) — the emblem-only crop (no
// wordmark, no tagline), used only at compact sizes alongside a live
// text wordmark. Never the full poster-style master lockup.
describe('TempaEmblem — the compact emblem-only crop, no wordmark/tagline baked in', () => {
  it('resolves the emblem asset, never the full master lockup', () => {
    const html = renderToStaticMarkup(<TempaEmblem />)
    expect(html).toContain(`url=${encodeURIComponent('/brand/tempa-emblem.png')}`)
    expect(html).not.toContain('tempa-logo-master')
  })

  it('is decorative — empty alt and aria-hidden, since it always sits beside a live text wordmark', () => {
    const html = renderToStaticMarkup(<TempaEmblem />)
    expect(html).toContain('alt=""')
    expect(html.toLowerCase()).toContain('aria-hidden="true"')
  })

  it('renders square at the requested size (source is a 1:1 crop)', () => {
    const html = renderToStaticMarkup(<TempaEmblem size={28} />)
    expect(html).toContain('width="28"')
    expect(html).toContain('height="28"')
  })

  it('defaults to a small, compact size appropriate for sitting beside text', () => {
    const html = renderToStaticMarkup(<TempaEmblem />)
    expect(html).toContain('width="32"')
    expect(html).toContain('height="32"')
  })

  it('passes through a className for caller-controlled sizing/placement', () => {
    const html = renderToStaticMarkup(<TempaEmblem className="rounded-md" />)
    expect(html).toMatch(/class="[^"]*rounded-md[^"]*"/)
  })
})
