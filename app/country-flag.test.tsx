import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CountryFlag, { flagAssetPath } from './country-flag'

describe('flagAssetPath — pure local-asset path mapping', () => {
  it('maps an ISO code to its local static SVG path', () => {
    expect(flagAssetPath('FR')).toBe('/flags/FR.svg')
    expect(flagAssetPath('BR')).toBe('/flags/BR.svg')
    expect(flagAssetPath('NG')).toBe('/flags/NG.svg')
  })

  it('is case-insensitive, always producing an uppercase filename', () => {
    expect(flagAssetPath('fr')).toBe('/flags/FR.svg')
  })

  it('never points at an external host — always a local, same-origin path', () => {
    expect(flagAssetPath('FR')).not.toMatch(/^https?:\/\//)
  })
})

describe('CountryFlag — deterministic vector flag, accessible, fails gracefully', () => {
  it('renders a keyboard-accessible button carrying the full country name as its accessible label', () => {
    const html = renderToStaticMarkup(<CountryFlag country="France" />)
    expect(html).toMatch(/<button[^>]*aria-label="Country: France"/)
  })

  // Visual-fidelity pass (2026-09-10): a real vector flag image, never
  // the raw two-letter ISO code or country name as visible text — the
  // defect this fix closes was exactly bare "BR"/"NG" text rendering
  // instead of a graphical flag on some platforms.
  it('renders an actual local SVG flag image, never bare ISO-code or country-name text', () => {
    const html = renderToStaticMarkup(<CountryFlag country="Brazil" />)
    expect(html).toContain('<img')
    expect(html).toContain('src="/flags/BR.svg"')
    expect(html).not.toMatch(/>BR</)
    expect(html).not.toMatch(/>Brazil</)
  })

  it('renders the correct flag for a different country', () => {
    const html = renderToStaticMarkup(<CountryFlag country="Nigeria" />)
    expect(html).toContain('src="/flags/NG.svg"')
  })

  it('the flag image is decorative — empty alt, aria-hidden, real accessible name lives on the button', () => {
    const html = renderToStaticMarkup(<CountryFlag country="France" />)
    expect(html).toMatch(/<img[^>]*alt=""/)
    expect(html).toMatch(/<img[^>]*aria-hidden="true"/)
  })

  it('is compact and fixed-size, so it never introduces layout shift', () => {
    const html = renderToStaticMarkup(<CountryFlag country="France" />)
    expect(html).toMatch(/<img[^>]*class="[^"]*h-\[9px\][^"]*w-\[13px\][^"]*"/)
  })

  it('renders nothing when the member has no country recorded', () => {
    const html = renderToStaticMarkup(<CountryFlag country={null} />)
    expect(html).toBe('')
  })

  it('renders nothing for a country string that does not resolve to a known ISO code, rather than a broken flag', () => {
    const html = renderToStaticMarkup(<CountryFlag country="Not A Real Country" />)
    expect(html).toBe('')
  })

  it('does not rely solely on the HTML title attribute for the disclosure', () => {
    const html = renderToStaticMarkup(<CountryFlag country="France" />)
    expect(html).not.toContain('title="France"')
  })
})
