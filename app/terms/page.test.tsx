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

  it('describes eligibility as an adult (18+) requirement', () => {
    expect(html).toContain('at least 18 years old')
  })

  it('prohibits eligibility-check circumvention and block evasion', () => {
    expect(html).toContain('adult-eligibility check')
    expect(html).toContain('get around a block')
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

  describe('the content licence granted by members', () => {
    it('is properly scoped: worldwide, non-exclusive, royalty-free, limited to operating Tempa', () => {
      expect(html).toContain('worldwide')
      expect(html).toContain('non-exclusive')
      expect(html).toContain('royalty-free')
      expect(html).toContain('reasonably necessary to operate')
    })

    it('does not transfer ownership, and never allows private letters to be republished as advertising', () => {
      expect(html).toContain('does not transfer ownership')
      expect(html).toContain('does not let us publish your private letters as advertising')
    })

    it('retains ownership of content with the member', () => {
      expect(html).toContain('You retain ownership')
    })
  })

  describe('prohibited system abuse', () => {
    it('prohibits scraping, bots, security interference, and malware', () => {
      expect(html.toLowerCase()).toContain('scrape')
      expect(html.toLowerCase()).toContain('bots')
      expect(html.toLowerCase()).toContain('malware')
    })
  })

  describe('the liability clause', () => {
    it('never purports to exclude liability the law does not permit excluding (fraud, wilful misconduct, gross negligence)', () => {
      expect(html).toContain('fraud')
      expect(html).toContain('wilful misconduct')
      expect(html).toContain('gross negligence')
      expect(html).toContain('does not permit us to exclude')
    })

    it('uses a non-zero fallback cap, not just "amount paid"', () => {
      expect(html).toContain('US$100')
      expect(html).toContain('the greater of')
    })
  })

  describe('the indemnity clause', () => {
    it('is narrowed to unlawful content, fraud/misuse, or material violation — not a blanket indemnity', () => {
      expect(html).toContain('unlawful or infringes')
      expect(html).toContain('fraud or intentional misuse')
      expect(html).toContain('material violation')
    })

    it('does not purport to cover claims arising from Tempa’s own unlawful conduct', () => {
      expect(html).toContain('own unlawful conduct')
    })
  })

  it('includes an intellectual-property complaint contact pointing to legal@jointempa.com', () => {
    expect(html).toContain('legal@jointempa.com')
    expect(html).toContain('infringes your intellectual property')
  })

  it('includes a governing-law clause for Nigeria that preserves mandatory consumer rights, and does not add arbitration', () => {
    const lower = html.toLowerCase()
    expect(lower).toContain('governed by the laws of nigeria')
    expect(lower).toContain('mandatory consumer-protection rights')
    expect(lower).not.toContain('arbitration')
  })

  it('does not document unreleased functionality as current (no paid plans, ads, or Tempa Kids)', () => {
    const lower = html.toLowerCase()
    expect(lower).not.toContain('subscription')
    expect(lower).not.toContain('advertising system')
    expect(lower).not.toContain('tempa kids')
    expect(lower).not.toContain('payment processor')
  })
})
