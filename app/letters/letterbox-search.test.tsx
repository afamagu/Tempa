import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterboxSearch from './letterbox-search'
import type { RelationshipSurfacePerson } from '@/lib/relationship-surface'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ data: [], error: null }) }) }))

const PEOPLE: RelationshipSurfacePerson[] = [
  {
    userId: 'user-1',
    pseudonym: 'Elvis',
    country: 'US',
    ageRange: '25-34',
    activityAt: 1,
    unreadCount: 0,
    latestExcerpt: 'Hello there',
    lastLetterFromViewer: false,
    relationshipState: 'established',
    pendingDirection: null,
    livingCorrespondenceId: 'correspondence-1',
    statusText: 'Your correspondence continues',
  },
]

describe('LetterboxSearch', () => {
  it('empty query restores the normal relationship view, not search results', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set()} />)
    expect(html).toContain('Elvis')
    expect(html).toContain('Correspondence')
    expect(html).not.toContain('No results')
    expect(html).not.toContain('Searching')
  })

  it('uses correspondence language in the accessible search field', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set()} />)
    expect(html).toContain('aria-label="Search your correspondence"')
    expect(html).not.toContain('pen pals')
  })

  it('keeps the relationship-first empty state when there are no people at all', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={[]} mailInTransitPersonIds={new Set()} />)
    expect(html).toContain('No correspondence yet.')
  })

  it('shows mail in transit only for a person actually in mailInTransitPersonIds', () => {
    const withTransit = renderToStaticMarkup(
      <LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set(['user-1'])} />
    )
    expect(withTransit).toContain('Mail on the way')

    const withoutTransit = renderToStaticMarkup(
      <LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set()} />
    )
    expect(withoutTransit).not.toContain('Mail on the way')
  })
})
