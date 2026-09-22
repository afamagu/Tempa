import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CommunityGuidelinesPage, { metadata } from './page'
import { CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'

describe('CommunityGuidelinesPage', () => {
  const html = renderToStaticMarkup(<CommunityGuidelinesPage />)
  const lower = html.toLowerCase()

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
    expect(lower).toContain('report')
    expect(lower).toContain('block')
  })

  it('links to Terms of Service and Safety', () => {
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/safety"')
  })

  describe('expanded, specific prohibited-conduct categories', () => {
    it('covers age circumvention and impersonation, distinct from a welcome pseudonym', () => {
      expect(lower).toContain('impersonating')
      expect(lower).toContain('eligibility check')
    })

    it('covers harassment, stalking, and block evasion', () => {
      expect(lower).toContain('harassment')
      expect(lower).toContain('stalking')
      expect(lower).toContain('get around a block')
    })

    it('covers hateful/dehumanizing conduct and unwanted sexual solicitation', () => {
      expect(lower).toContain('hateful or dehumanizing')
      expect(lower).toContain('unwanted sexual')
    })

    it('places an absolute, no-exceptions prohibition on child sexual exploitation and grooming', () => {
      expect(lower).toContain('grooming')
      expect(lower).toContain('never allowed, under any circumstance')
    })

    it('covers financial and romance scams, and pressure to move off-platform', () => {
      expect(lower).toContain('romance scams')
      expect(lower).toContain('cryptocurrency')
      expect(lower).toContain('move your conversation off tempa')
    })

    it('covers doxxing/privacy violations and non-consensual intimate imagery/sextortion', () => {
      expect(lower).toContain('personal information without their consent')
      expect(lower).toContain('intimate images')
      expect(lower).toContain('extort')
    })

    it('covers credible threats of violence and serious unlawful activity', () => {
      expect(lower).toContain('credible threats of serious violence')
      expect(lower).toContain('serious unlawful activity')
    })

    it('covers spam, manipulated engagement, scraping/bots, and phishing/malware', () => {
      expect(lower).toContain('spam')
      expect(lower).toContain('manipulating engagement')
      expect(lower).toContain('scraping')
      expect(lower).toContain('phishing')
    })

    it('covers intellectual property infringement', () => {
      expect(lower).toContain('intellectual property rights')
    })

    it('covers bad-faith/abusive reporting as its own violation', () => {
      expect(lower).toContain('bad faith')
    })
  })

  it('preserves context-sensitive language: difficult subjects (grief, mental health) are not banned outright', () => {
    expect(lower).toContain('grief')
    expect(lower).toContain('mental health')
    expect(lower).toContain('not what these guidelines are here to stop')
  })

  it('does not document unreleased functionality as current (no paid plans, Tempa-run ads, or Tempa Kids)', () => {
    // The Guidelines legitimately prohibit MEMBERS from using Tempa for
    // unsolicited commercial solicitation/spam — that's a conduct rule,
    // not a claim that Tempa itself runs an ad system, so only the
    // latter is checked for here.
    expect(lower).not.toContain('subscription')
    expect(lower).not.toContain('advertising system')
    expect(lower).not.toContain('sponsored')
    expect(lower).not.toContain('tempa kids')
  })
})
