import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TempaBrandLogo from './tempa-brand-logo'

// Brand asset pass (2026-09-24) — the approved full lockup, used ONLY
// where there is real room for it (see app/sign-in/page.tsx). These
// tests prove the component's own contract: correct asset, meaningful
// alt text, a square (undistorted) aspect ratio, and a configurable
// display size — never that any particular page uses it (that's each
// page's own test, if one exists).
describe('TempaBrandLogo — the full brand lockup, used only where it has room to breathe', () => {
  it('resolves the approved master-logo asset (byte-for-byte copied into public/brand)', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo />)
    expect(html).toContain(`url=${encodeURIComponent('/brand/tempa-logo-master.png')}`)
  })

  it('has real, descriptive alt text — never decorative, since this is the primary brand mark', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo />)
    expect(html).toContain('alt="Tempa — A more human way to connect"')
  })

  it('renders at a square 1:1 ratio by default, matching the source — never stretched/distorted', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo width={200} />)
    expect(html).toContain('width="200"')
    expect(html).toContain('height="200"')
  })

  it('accepts a custom width, keeping height equal to it (still square)', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo width={140} />)
    expect(html).toContain('width="140"')
    expect(html).toContain('height="140"')
  })

  it('supports the priority flag for above-the-fold placements', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo priority />)
    // next/image with priority renders without native lazy loading.
    expect(html).not.toContain('loading="lazy"')
  })

  it('passes through a className for the caller to control placement/spacing', () => {
    const html = renderToStaticMarkup(<TempaBrandLogo className="mx-auto" />)
    expect(html).toMatch(/class="[^"]*mx-auto[^"]*"/)
  })
})
