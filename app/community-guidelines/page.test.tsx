import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CommunityGuidelinesPage, { metadata } from './page'
import { CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'

describe('CommunityGuidelinesPage', () => {
  const html = renderToStaticMarkup(<CommunityGuidelinesPage />)

  it('renders without throwing', () => {
    expect(html).toContain('Community Guidelines')
  })

  it('has a descriptive page title', () => {
    expect(metadata.title).toBe('Community Guidelines — Tempa')
  })

  it('exposes the current Community Guidelines version, 2026-09-launch-v1', () => {
    expect(CURRENT_COMMUNITY_GUIDELINES_VERSION).toBe('2026-09-launch-v1')
    expect(html).toContain(CURRENT_COMMUNITY_GUIDELINES_VERSION)
  })

  it('mentions reporting and blocking as supported, member-controlled tools', () => {
    expect(html.toLowerCase()).toContain('report')
    expect(html.toLowerCase()).toContain('block')
  })

  it('links to Terms of Service and Safety', () => {
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/safety"')
  })

  it('does not document unreleased functionality as current (no paid plans, Tempa-run ads, or Tempa Kids)', () => {
    const lower = html.toLowerCase()
    expect(lower).not.toContain('subscription')
    // The Guidelines legitimately prohibit MEMBERS from using Tempa to
    // advertise their own products/services (see "What's not allowed")
    // — that's a conduct rule, not a claim that Tempa itself runs an ad
    // system, so only the latter is checked for here.
    expect(lower).not.toContain('advertising system')
    expect(lower).not.toContain('sponsored')
    expect(lower).not.toContain('tempa kids')
  })
})
