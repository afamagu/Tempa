import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage, { metadata } from './page'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal'

describe('PrivacyPage', () => {
  const html = renderToStaticMarkup(<PrivacyPage />)

  it('renders without throwing', () => {
    expect(html).toContain('Privacy Notice')
  })

  it('has a descriptive page title', () => {
    expect(metadata.title).toBe('Privacy Notice — Tempa')
  })

  it('shows the effective date, but carries no version — Privacy is presented, not versioned/accepted like Terms and Community Guidelines', () => {
    expect(html).toContain(LEGAL_EFFECTIVE_DATE)
    expect(html.toLowerCase()).not.toContain('version 2026')
  })

  it('describes itself as a notice, not a contractual acceptance requirement', () => {
    expect(html).toContain('not a contract')
  })

  it('states exact date of birth is private and never shown on the member-facing profile', () => {
    expect(html).toContain('is never shown on your member-facing profile')
  })

  it('describes the under-18 retention design accurately: the derived date is kept, calculated from the submitted DOB, and is explicitly NOT called anonymous', () => {
    expect(html).toContain('keep that exact date of birth')
    expect(html).toContain('What we do keep is a derived date')
    expect(html).toContain('calculated directly from the date of birth you gave us')
    expect(html).toContain('it is not anonymous')
  })

  it('never claims Tempa "no longer retains" birth-date-derived information outright', () => {
    // Matches the migration's own corrected wording requirement
    // (docs/sql/2026-09-21-adult-eligibility-and-legal-acceptance.sql's
    // "UNDER-18 HANDLING AND PRIVACY WORDING" header) — the derived date
    // must be described as retained, not as evidence of discarding the
    // underlying birth-date information.
    expect(html).not.toContain('no longer retain')
  })

  it('describes Your Mark accurately: source photo processed on-device and not uploaded, only the generated Mark is', () => {
    expect(html).toContain('processing happens locally on your own device')
    expect(html).toContain('is not uploaded to Tempa')
    expect(html).toContain('Only the generated Mark image is uploaded')
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

  it('accurately names Supabase and Cloudflare Turnstile as infrastructure, without stating a specific unverified region', () => {
    expect(html).toContain('Supabase')
    expect(html).toContain('Turnstile')
    expect(html.toLowerCase()).not.toMatch(/\b(us-east|us-west|eu-west|eu-central|ap-southeast|ap-northeast)-?\d?\b/)
  })

  it('does not invent analytics/tracking infrastructure', () => {
    const lower = html.toLowerCase()
    expect(lower).not.toContain('google analytics')
    expect(lower).not.toContain('tracking pixel')
    expect(lower).not.toContain('advertising id')
  })
})
