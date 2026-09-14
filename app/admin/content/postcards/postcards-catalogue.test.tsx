import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardsCatalogue from './postcards-catalogue'
import type { AdminPostcard } from '@/lib/admin-postcards'

// PostcardRow (rendered by PostcardsCatalogue for every row) calls
// useRouter() and createClient() — neither exists in this SSR-only
// renderToStaticMarkup harness, same mocking convention as
// app/letters/letterbox-search.test.tsx.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

function postcard(overrides: Partial<AdminPostcard> = {}): AdminPostcard {
  return {
    key: 'essaouira',
    isActive: true,
    createdAt: '2026-09-14T00:00:00Z',
    currentVersionId: 'pv-1',
    versionNumber: 1,
    title: 'Essaouira',
    countryCode: 'MA',
    location: 'Atlantic Morocco',
    collection: 'Atlantic Morocco Collection',
    postmarkText: 'ESSAOUIRA\nATLANTIC MOROCCO',
    footerText: 'Tempa Postcard · Atlantic Morocco Collection',
    frontImagePath: '/postcards/essaouira.jpg',
    motionSrc: null,
    durationSeconds: null,
    revealLineAlignment: null,
    timesSent: 2,
    ...overrides,
  }
}

const BANGKOK = postcard({
  key: 'bangkokAfterRain',
  title: 'Bangkok',
  countryCode: 'TH',
  location: 'Thailand after rain',
  collection: 'Thailand After Rain Collection',
  frontImagePath: '/postcards/bangkok-after-rain.jpg',
  timesSent: 2,
})

describe('PostcardsCatalogue — search field', () => {
  it('renders a restrained search field with the specified placeholder', () => {
    const html = renderToStaticMarkup(<PostcardsCatalogue postcards={[postcard(), BANGKOK]} />)
    expect(html).toContain('placeholder="Search Postcards…"')
    expect(html).toContain('aria-label="Search Postcards"')
  })

  it('with no query, shows every Postcard, active and inactive both', () => {
    const html = renderToStaticMarkup(
      <PostcardsCatalogue postcards={[postcard(), BANGKOK, postcard({ key: 'retired', title: 'Retired', isActive: false })]} />
    )
    expect(html).toContain('Essaouira')
    expect(html).toContain('Bangkok')
    expect(html).toContain('Retired')
  })

  it('renders every Postcard\'s times-sent count using natural copy, not the old "2 sents" bug', () => {
    const html = renderToStaticMarkup(<PostcardsCatalogue postcards={[postcard({ timesSent: 2 })]} />)
    expect(html).toContain('Sent 2 times')
    expect(html).not.toContain('2 sents')
  })

  it('a singular sent count reads "Sent once"', () => {
    const html = renderToStaticMarkup(<PostcardsCatalogue postcards={[postcard({ timesSent: 1 })]} />)
    expect(html).toContain('Sent once')
  })
})
