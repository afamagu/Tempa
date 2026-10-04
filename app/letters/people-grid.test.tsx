import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PeopleGrid from './people-grid'
import type { LetterboxPerson } from '@/lib/letters'

function person(overrides: Partial<LetterboxPerson> = {}): LetterboxPerson {
  return {
    userId: 'user-1',
    pseudonym: 'Evening Quill',
    country: 'South Africa',
    ageRange: '25-34',
    activityAt: Date.now(),
    unreadCount: 0,
    latestExcerpt: 'A short excerpt of the most recent letter.',
    lastLetterFromViewer: false,
    ...overrides,
  }
}

describe('PeopleGrid — relationship-first rows', () => {
  it('renders one calm row per person rather than a portrait-card gallery', () => {
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

  it('shows country and age range as quiet metadata beneath the pseudonym', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ country: 'South Africa', ageRange: '25-34' })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('South Africa · 25-34')
  })

  it('links the whole relationship row to the correspondence archive, never the public profile', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('href="/letters/with/user-1"')
    expect(html).not.toContain('href="/minds/user-1"')
  })
})

describe('PeopleGrid — latest context is a preview, not a reading surface', () => {
  const longMultiParagraphBody =
    'This is the first paragraph of a fairly long letter, long enough on its own to wrap across more ' +
    'than two visual lines in a compact row, which is exactly the case this test exists for.\n\n' +
    'SECOND_PARAGRAPH_MARKER — this text must never appear in Letterbox.\n\n' +
    'THIRD_PARAGRAPH_MARKER — same requirement.'

  it('shows the latest visible excerpt and keeps a two-line clamp', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ latestExcerpt: longMultiParagraphBody })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('first paragraph of a fairly long letter')
    expect(html).toContain('line-clamp-2')
    expect(html).not.toContain('SECOND_PARAGRAPH_MARKER')
    expect(html).not.toContain('THIRD_PARAGRAPH_MARKER')
  })

  it('does not mutate the person object while producing a preview', () => {
    const thePerson = person({ latestExcerpt: longMultiParagraphBody })
    renderToStaticMarkup(<PeopleGrid people={[thePerson]} mailInTransitPersonIds={new Set()} />)
    expect(thePerson.latestExcerpt).toBe(longMultiParagraphBody)
  })
})

describe('PeopleGrid — relationship status language', () => {
  it('uses "Letter waiting" for unread incoming mail', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person({ unreadCount: 1 })]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('Letter waiting')
    expect(html).not.toContain('New letter')
  })

  it('uses "Quiet right now" instead of treating an unanswered sent letter as an inbox task', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ unreadCount: 0, lastLetterFromViewer: true })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('Quiet right now')
    expect(html).not.toContain('Waiting for a reply')
  })

  it('keeps a calm last-exchanged fallback when neither special state applies', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ unreadCount: 0, lastLetterFromViewer: false })]}
        mailInTransitPersonIds={new Set()}
      />
    )
    expect(html).toContain('Last exchanged')
  })
})

describe('PeopleGrid — unread and mail-in-transit remain independent', () => {
  it('can show both an unread badge and A letter is on the way context independently', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid
        people={[person({ unreadCount: 2 })]}
        mailInTransitPersonIds={new Set(['user-1'])}
      />
    )
    expect(html).toContain('2 unread letters')
    expect(html).toContain('Mail on the way')
  })

  it('a person with no unread and no transit mail shows neither auxiliary signal', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[person()]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).not.toContain('unread letter')
    expect(html).not.toContain('Mail on the way')
  })
})

describe('PeopleGrid — empty state', () => {
  it('frames emptiness as absence of correspondence, not absence of mail', () => {
    const html = renderToStaticMarkup(
      <PeopleGrid people={[]} mailInTransitPersonIds={new Set()} />
    )
    expect(html).toContain('No correspondence yet.')
    expect(html).toContain('first letter becomes a real exchange')
    expect(html).not.toContain("don&#x27;t have any letters yet")
  })
})
