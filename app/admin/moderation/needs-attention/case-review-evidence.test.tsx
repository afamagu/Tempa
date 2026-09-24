import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import CaseReviewEvidence from './case-review-evidence'
import type { CaseReview } from '@/lib/admin-safety'

const review: CaseReview = {
  summary: {
    subjectPseudonym: 'Sender',
    accountCreatedAt: '2026-09-20T10:00:00Z',
    accountAgeDays: 4,
    accountStatus: 'restricted',
    restrictionPendingReview: true,
    statusChangedAt: '2026-09-24T12:00:00Z',
    qualifyingAttempts72h: 5,
    distinctContexts72h: 3,
    qualifyingAttemptsTotal: 5,
    firstQualifyingAttemptAt: '2026-09-24T09:00:00Z',
    lastQualifyingAttemptAt: '2026-09-24T11:59:00Z',
    firstContacts24h: 6,
    distinctFirstContactRecipients24h: 6,
    contactSharingEvaluations30d: 2,
    behavioralSignals30d: { REPEATED_SOLICITATION: 1, HIGH_CONTACT_VELOCITY: 1 },
  },
  attempts: [
    {
      evaluationId: 'e1',
      createdAt: '2026-09-24T11:59:00Z',
      surface: 'first_letter',
      recipientOrdinal: 'Person C',
      reasonCodes: ['DIRECT_MONEY_REQUEST'],
      riskBand: 'high',
      mutationDisposition: 'deny',
      qualifying: true,
      sent: false,
      attemptedTitle: null,
      attemptedTopics: null,
      attemptedBody: 'I have an urgent need for $100. Please help me.',
    },
  ],
}

describe('Needs Attention — attempt evidence panel', () => {
  const html = renderToStaticMarkup(<CaseReviewEvidence review={review} />)

  it('states the restriction is system-applied and awaiting a human decision', () => {
    expect(html).toContain('Restricted — pending review')
    expect(html).toContain('Restoring, keeping the restriction, suspending or banning is your decision.')
  })

  it('shows qualifying attempts, distinct recipients, timestamps and behavioural context', () => {
    expect(html).toContain('5 qualifying attempts in the last 72 hours, involving 3 distinct recipients')
    expect(html).toContain('6 first contacts in 24 hours to 6')
    expect(html).toContain('Account 4 days old')
    expect(html).toContain('Repeated solicitation pattern × 1')
    expect(html).toContain('allowed; context only')
  })

  it('shows the full text of a blocked, never-sent attempt with its reason and an anonymous recipient ordinal', () => {
    expect(html).toContain('I have an urgent need for $100. Please help me.')
    expect(html).toContain('Blocked — never sent')
    expect(html).toContain('Person C')
    expect(html).toContain('Money request')
    expect(html).toContain('counted toward the automatic rule')
  })

  it('never renders an id or a recipient name', () => {
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)
  })

  it('renders an empty state when no attempt text exists', () => {
    const empty = renderToStaticMarkup(<CaseReviewEvidence review={{ ...review, attempts: [] }} />)
    expect(empty).toContain('No attempt text was recorded for this member.')
  })
})
