import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SafetyPage, { metadata } from './page'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal'

describe('SafetyPage', () => {
  const html = renderToStaticMarkup(<SafetyPage />)
  const lower = html.toLowerCase()

  it('renders without throwing', () => {
    expect(html).toContain('Safety')
  })

  it('has a descriptive page title', () => {
    expect(metadata.title).toBe('Safety — Tempa')
  })

  it('shows the effective date, but carries no version — Safety is not one of the accepted/versioned documents', () => {
    expect(html).toContain(LEGAL_EFFECTIVE_DATE)
    expect(lower).not.toContain('version 2026')
  })

  it('describes reporting and blocking as real, member-controlled tools', () => {
    expect(lower).toContain('report')
    expect(lower).toContain('block')
  })

  it('states the adult (18+) eligibility requirement, honestly framed as self-reported rather than infallible', () => {
    expect(lower).toContain('at least 18')
    expect(lower).toContain('relies on what a person tells us')
  })

  it('honestly discloses correspondence is not end-to-end encrypted, and never claims that it is', () => {
    expect(lower).toContain('not end-to-end encrypted')
    expect(lower).not.toMatch(/\bis end-to-end encrypted\b/)
    expect(lower).not.toMatch(/\bare end-to-end encrypted\b/)
  })

  it('does not claim Tempa staff routinely reads private correspondence', () => {
    expect(html).toContain('make a practice of reading')
  })

  it('distinguishes Your Mark from a real photo, and confirms on-device processing', () => {
    expect(lower).toContain('not a photo of you')
    expect(lower).toContain('processed on your own device')
  })

  it('clarifies profile details are self-reported, not identity verification', () => {
    expect(lower).toContain('self-reported')
    expect(lower).toContain('not independently verified identity checks')
  })

  it('warns about pressure to move off-platform and financial/romance scams, without inventing a payment system', () => {
    expect(lower).toContain('rush you off tempa')
    expect(lower).toContain('never send money')
    expect(lower).toContain('cryptocurrency')
    expect(lower).not.toContain('payment processor')
  })

  it('addresses intimate images/sextortion, links/phishing, and meeting in person calmly', () => {
    expect(lower).toContain('intimate image')
    expect(lower).toContain('clicking a link')
    expect(lower).toContain('meet somewhere public')
  })

  it('covers account/sign-in security', () => {
    expect(lower).toContain('sign-in access')
  })

  it('states Tempa is not an emergency service and directs to local emergency services', () => {
    expect(lower).toContain('not an emergency service')
    expect(lower).toContain('local emergency services')
  })

  it('is calm and practical, not alarmist — never claims Tempa is unsafe by default', () => {
    expect(lower).not.toContain('dangerous')
    expect(lower).not.toContain('predator')
  })

  it('does not document Tempa Kids or other future products as if they already exist', () => {
    expect(lower).not.toContain('tempa kids')
  })
})
