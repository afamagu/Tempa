import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SafetyPage, { metadata } from './page'
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal'

describe('SafetyPage', () => {
  const html = renderToStaticMarkup(<SafetyPage />)

  it('renders without throwing', () => {
    expect(html).toContain('Safety')
  })

  it('has a descriptive page title', () => {
    expect(metadata.title).toBe('Safety — Tempa')
  })

  it('shows the effective date, but carries no version — Safety is not one of the accepted/versioned documents', () => {
    expect(html).toContain(LEGAL_EFFECTIVE_DATE)
    expect(html.toLowerCase()).not.toContain('version 2026')
  })

  it('describes reporting and blocking as real, member-controlled tools', () => {
    expect(html.toLowerCase()).toContain('report')
    expect(html.toLowerCase()).toContain('block')
  })

  it('states the adult (18+) eligibility requirement and that it is enforced by Tempa, not taken on trust', () => {
    expect(html).toContain('at least 18')
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

  it('does not document Tempa Kids or other future products as if they already exist', () => {
    expect(html.toLowerCase()).not.toContain('tempa kids')
  })
})
