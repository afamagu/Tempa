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

  describe('categories of information actually processed', () => {
    it('covers account/email/session information', () => {
      expect(html).toContain('email address you sign in with')
    })

    it('covers profile fields: pseudonym, country, region, languages, optional gender', () => {
      expect(html.toLowerCase()).toContain('pseudonym')
      expect(html).toContain('country (shown publicly)')
      expect(html).toContain('region (collected but not shown')
      expect(html.toLowerCase()).toContain('languages')
      expect(html.toLowerCase()).toContain('gender')
    })

    it('distinguishes public "Interests" (intent) from private reading interests, without conflating them', () => {
      expect(html).toContain('shown publicly as')
      expect(html).toContain('Reading interests (kept private)')
      expect(html).toContain('never shown on your profile or to other members')
    })

    it('covers Question answers, Your Mark, letters, Dispatches, and Worth Reading', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('question answer')
      expect(lower).toContain('your mark')
      expect(lower).toContain('letters')
      expect(lower).toContain('dispatches')
      expect(lower).toContain('worth reading')
    })

    it('covers reports/blocks/moderation and legal acceptance records', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('reports, blocks')
      expect(lower).toContain('legal acceptance records')
    })

    it('covers technical/security information and Cloudflare Turnstile', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('technical and security information')
      expect(lower).toContain('turnstile')
    })
  })

  describe('the automated adult-eligibility decision', () => {
    it('explains the server compares submitted DOB against the current date', () => {
      expect(html).toContain('compares the date of birth you submit against the current date')
    })

    it('states 18+ may proceed and under-18 cannot', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('confirms you’re 18 or older, you can continue')
      expect(lower).toContain('it doesn’t, you can’t continue')
    })

    it('confirms no facial-age estimation or personality/behavioral scoring is used', () => {
      expect(html).toContain('does not use facial-age estimation')
      expect(html).toContain('personality or behavioral scoring')
    })

    it('directs a member who believes the decision was wrong to privacy/support', () => {
      expect(html).toContain('believe this decision was made in error')
      expect(html).toContain('privacy@jointempa.com')
      expect(html).toContain('support@jointempa.com')
    })
  })

  describe('lawful basis for processing (hedged, not asserting a specific regulatory regime)', () => {
    it('lists contract, legitimate interests, legal obligation, consent, and vital interests', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('performance of a contract')
      expect(lower).toContain('legitimate interests')
      expect(lower).toContain('legal obligation')
      expect(lower).toContain('vital interests')
    })

    it('does not invent a consent-based activity — states consent is not currently relied on for core features', () => {
      expect(html).toContain('don’t currently rely on consent as the basis for Tempa’s core features')
    })
  })

  describe('recipients of information', () => {
    it('lists other members (scoped by audience), Supabase, Cloudflare, Vercel, and advisers/authorities "only where appropriate"', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('other tempa members')
      expect(lower).toContain('cloudflare')
      expect(lower).toContain('only where appropriate')
    })

    it('accurately states Vercel hosts the web application and Supabase provides backend infrastructure — never reversed', () => {
      expect(html).toContain('Vercel hosts the Tempa web application')
      expect(html).toContain('Supabase provides backend infrastructure')
      expect(html.toLowerCase()).not.toContain('supabase hosts')
      expect(html.toLowerCase()).not.toContain('supabase, which hosts our application')
    })

    it('never sells information', () => {
      expect(html).toContain('don’t sell your information')
    })
  })

  it('addresses international processing without naming an unverified physical region', () => {
    expect(html).toContain('countries other than the one you live in')
    expect(html).not.toMatch(/\b(us-east|us-west|eu-west|eu-central|ap-southeast|ap-northeast)-?\d?\b/i)
  })

  describe('retention by category, not a single blanket period', () => {
    it('covers account/profile, DOB/eligibility, eligible_on, legal acceptances, content, reports, technical logs, and backups', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('account and profile information')
      expect(lower).toContain('date of birth and eligibility status')
      expect(lower).toContain('derived eligibility date')
      expect(lower).toContain('legal acceptance records')
      expect(lower).toContain('letters, dispatches, and other content')
      expect(lower).toContain('reports, blocks, and enforcement records')
      expect(lower).toContain('technical and security logs')
      expect(lower).toContain('backups')
    })

    it('does not invent an exact retention period', () => {
      expect(html).not.toMatch(/\b\d+\s*(day|month|year)s?\b/i)
      expect(html).toContain('haven’t set')
    })
  })

  describe('privacy rights', () => {
    it('lists access, rectification, erasure, restriction, objection, portability, and consent withdrawal', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('access it')
      expect(lower).toContain('corrected')
      expect(lower).toContain('ask us to delete')
      expect(lower).toContain('restrict certain processing')
      expect(lower).toContain('object to certain processing')
      expect(lower).toContain('portable format')
      expect(lower).toContain('withdraw consent')
    })

    it('covers rights concerning the automated eligibility decision, and complaint to a data protection authority', () => {
      const lower = html.toLowerCase()
      expect(lower).toContain('qualifying automated decision')
      expect(lower).toContain('data protection authority that has jurisdiction over you')
    })

    it('directs rights requests to privacy@jointempa.com', () => {
      const rightsSection = html.slice(html.indexOf('11. Your privacy rights'))
      expect(rightsSection).toContain('privacy@jointempa.com')
    })
  })

  it('addresses cookies/session/security technology, and explicitly disclaims running analytics or advertising trackers (never claims to use them)', () => {
    const lower = html.toLowerCase()
    expect(lower).toContain('session technology')
    expect(lower).toContain('don’t run analytics trackers or advertising technology')
  })

  it('does not invent unreleased functionality as current (no payments, ads, or Tempa Kids)', () => {
    const lower = html.toLowerCase()
    expect(lower).toContain('don’t process payment information')
    expect(lower).not.toContain('tempa kids')
  })
})
