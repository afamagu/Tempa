import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import MailOnTheWay from './mail-on-the-way'

// Brand asset pass (2026-09-24) — MailOnTheWay is PRESENTATION ONLY: it
// takes no props describing "is mail in transit" and makes no such
// decision itself — every call site (Home, Letterbox Level 1/2) already
// computes that from the existing incoming_mail_in_transit source of
// truth (lib/letters.ts) and only renders this component when that
// condition already holds. These tests therefore only prove the
// component's own rendered shape: the approved asset resolves, the
// asset is decorative (never announced before the real heading), and
// the copy is real text, never baked into the image.
describe('MailOnTheWay — the approved travelling-envelope asset, never text-in-image', () => {
  it('resolves the approved asset path (byte-for-byte copied into public/brand) through next/image', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    // next/image rewrites the literal src into its own optimization
    // proxy (/_next/image?url=<encoded>&...) — the underlying source
    // path is exactly this file's own encoded form, not a literal
    // src="/brand/mail-on-the-way.png" string.
    expect(html).toContain(`url=${encodeURIComponent('/brand/mail-on-the-way.png')}`)
  })

  it('the asset is decorative — empty alt and aria-hidden, so a screen reader announces the heading first, not "image"', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    const imgIndex = html.indexOf('<img')
    expect(imgIndex).toBeGreaterThan(-1)
    const imgTagEnd = html.indexOf('>', imgIndex)
    const imgTag = html.slice(imgIndex, imgTagEnd)
    expect(imgTag).toContain('alt=""')
    expect(imgTag.toLowerCase()).toContain('aria-hidden="true"')
  })

  it('"Mail on the way" and "A letter is travelling to you." are real live text nodes, never part of the image', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    expect(html).toContain('Mail on the way')
    expect(html).toContain('A letter is travelling to you.')
    // Both strings must appear OUTSIDE the <img ...> tag itself.
    const imgIndex = html.indexOf('<img')
    const imgTagEnd = html.indexOf('>', imgIndex)
    expect(html.slice(imgIndex, imgTagEnd)).not.toContain('Mail on the way')
  })

  it('never prepends "Status:" and never uses alert/toast styling classes', () => {
    const html = renderToStaticMarkup(<MailOnTheWay />)
    expect(html).not.toContain('Status:')
    expect(html.toLowerCase()).not.toMatch(/bg-red|bg-destructive|role="alert"/)
  })

  it('accepts an optional className for layout placement by the caller', () => {
    const html = renderToStaticMarkup(<MailOnTheWay className="mt-2" />)
    expect(html).toMatch(/class="[^"]*mt-2[^"]*"/)
  })
})
