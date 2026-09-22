import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TermsPage, { metadata } from './page'
import { CURRENT_TERMS_VERSION } from '@/lib/legal'

describe('TermsPage', () => {
  const html = renderToStaticMarkup(<TermsPage />)

  it('renders without throwing', () => {
    expect(html).toContain('Terms of Service')
  })

  it('has a descriptive page title', () => {
    expect(metadata.title).toBe('Terms of Service — Tempa')
  })

  it('exposes the current Terms version, 2026-09-launch-v1', () => {
    expect(CURRENT_TERMS_VERSION).toBe('2026-09-launch-v1')
    expect(html).toContain(CURRENT_TERMS_VERSION)
  })

  it('links to the Privacy Notice and Community Guidelines', () => {
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('href="/community-guidelines"')
  })

  it('describes eligibility as an adult (18+) requirement, without revealing the exact cutoff phrasing used on /begin', () => {
    expect(html).toContain('at least 18 years old')
  })

  it('describes Your Mark accurately: source photo processed on-device and not uploaded, only the generated Mark is', () => {
    expect(html).toContain('processed on your own device')
    expect(html).toContain('is not uploaded to Tempa')
    expect(html).toContain('Only the resulting Mark image is uploaded')
  })

  it('honestly discloses correspondence is not end-to-end encrypted, and never claims that it is', () => {
    const lower = html.toLowerCase()
    expect(lower).toContain('not end-to-end encrypted')
    expect(lower).not.toMatch(/\bis end-to-end encrypted\b/)
    expect(lower).not.toMatch(/\bare end-to-end encrypted\b/)
  })

  it('does not claim Tempa staff routinely reads private correspondence', () => {
    expect(html).toContain('make a practice of reading')
  })

  it('mentions reporting and blocking support', () => {
    expect(html.toLowerCase()).toContain('reporting and blocking')
  })

  it('includes limitation of liability and indemnity sections', () => {
    expect(html.toLowerCase()).toContain('limitation of liability')
    expect(html.toLowerCase()).toContain('indemnity')
  })

  it('does not document unreleased functionality as current (no paid plans, ads, or Tempa Kids)', () => {
    const lower = html.toLowerCase()
    expect(lower).not.toContain('subscription')
    expect(lower).not.toContain('advertis')
    expect(lower).not.toContain('tempa kids')
    expect(lower).not.toContain('payment processor')
  })
})
