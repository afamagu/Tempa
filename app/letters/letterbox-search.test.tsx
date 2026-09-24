import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterboxSearch from './letterbox-search'
import type { LetterboxPerson } from '@/lib/letters'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ rpc: async () => ({ data: [], error: null }) }) }))

const PEOPLE: LetterboxPerson[] = [
  {
    userId: 'user-1',
    pseudonym: 'Elvis',
    country: 'US',
    ageRange: '25-34',
    activityAt: 1,
    unreadCount: 0,
    latestExcerpt: 'Hello there',
    lastLetterFromViewer: false,
  },
]

describe('LetterboxSearch', () => {
  it('empty query (initial state) restores the normal people grid, not a search-results view', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set()} />)
    // The people grid renders this person's card...
    expect(html).toContain('Elvis')
    // ...and none of the search-results-only copy is present.
    expect(html).not.toContain('No results')
    expect(html).not.toContain('Searching')
  })

  it('renders the search field with an accessible label', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={PEOPLE} mailInTransitPersonIds={new Set()} />)
    expect(html).toContain('aria-label="Search your pen pals"')
  })

  it('the empty-state people grid still shows its own genuinely-empty message when there are no people at all', () => {
    const html = renderToStaticMarkup(<LetterboxSearch people={[]} mailInTransitPersonIds={new Set()} />)
    expect(html).toContain("don&#x27;t have any letters yet")
  })

  it('shows the mail-on-the-way indicator only for a person actually in mailInTransitPersonIds', () => {
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
