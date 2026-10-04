import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PeopleGrid from './people-grid'
import type { RelationshipSurfacePerson } from '@/lib/relationship-surface'

function person(overrides: Partial<RelationshipSurfacePerson> = {}): RelationshipSurfacePerson {
  return {
    userId: 'user-1',
    pseudonym: 'Evening Quill',
    country: 'South Africa',
    ageRange: '25-34',
    activityAt: Date.now(),
    unreadCount: 0,
    latestExcerpt: 'A short excerpt of the most recent letter.',
    lastLetterFromViewer: false,
    relationshipState: 'established',
    pendingDirection: null,
    livingCorrespondenceId: 'correspondence-1',
    statusText: 'Your correspondence continues',
    ...overrides,
  }
}

describe('PeopleGrid — relationship-first hierarchy', () => {
  it('renders established correspondence before first letters and past correspondence', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[
          person({ userId: 'past', pseudonym: 'Past Person', relationshipState: 'past', livingCorrespondenceId: null, statusText: 'Past correspondence' }),
          person({ userId: 'pending', pseudonym: 'Pending Person', relationshipState: 'pending', pendingDirection: 'outgoing', statusText: 'Your first letter is waiting for a response' }),
          person({ userId: 'active', pseudonym: 'Active Person', relationshipState: 'established', statusText: 'Quiet right now' }),
        ]}
        mailInTransitPersonIds={new Set()}
      />
    )

    expect(html.indexOf('>Correspondence<')).toBeLessThan(html.indexOf('>First letters<'))
    expect(html.indexOf('>First letters<')).toBeLessThan(html.indexOf('>Past correspondence<'))
    expect(html.indexOf('Active Person')).toBeLessThan(html.indexOf('Pending Person'))
    expect(html.indexOf('Pending Person')).toBeLessThan(html.indexOf('Past Person'))
  })

  it('renders relationship rows rather than a portrait-card grid', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('divide-y')
    expect(html).not.toMatch(/grid-cols-1[^\"]*sm:grid-cols-2[^\"]*lg:grid-cols-3/)
  })

  it('keeps the pseudonym visually primary', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toMatch(/text-\[17px\][^\"]*font-semibold[^\"]*[^>]*>\s*Evening Quill/)
  })

  it('links the whole relationship row to the correspondence archive, never the public profile', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('href="/letters/with/user-1"')
    expect(html).not.toContain('href="/minds/user-1"')
  })
})

describe('PeopleGrid — status and context', () => {
  it('renders the shared relationship status rather than deriving a conflicting local status', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ statusText: 'Your turn · within your usual rhythm' })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('Your turn · within your usual rhythm')
  })

  it('shows the latest visible excerpt but never the second paragraph', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ latestExcerpt: 'First paragraph.\n\nSECOND_PARAGRAPH_MARKER' })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('First paragraph.')
    expect(html).not.toContain('SECOND_PARAGRAPH_MARKER')
    expect(html).toContain('line-clamp-2')
  })

  it('keeps mail in transit independent from the relationship status', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ unreadCount: 2, statusText: 'Letter waiting' })]}
        mailInTransitPersonIds={new Set(['user-1'])}
      />
    )
    expect(html).toContain('2 unread letters')
    expect(html).toContain('Letter waiting')
    expect(html).toContain('Mail on the way')
  })
})

describe('PeopleGrid — empty state', () => {
  it('frames emptiness as absence of correspondence rather than absence of mail', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('No correspondence yet.')
    expect(html).toContain('first letter begins an exchange')
    expect(html).not.toContain('Pen Pals')
  })
})
