import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EditorialByline from './editorial-byline'
import { resolveDispatchIdentity } from '@/lib/dispatch-identity'
import DispatchIdentityLabel from './board/dispatch-identity-label'
import DispatchAuthorLink from './board/dispatch-author-link'
import RecommendedMindCard from './home/recommended-mind-card'
import DiscoveryResults from './room/discovery-results'
import PublicDispatchCard from './dispatches/public-dispatch-card'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const TITLE = 'Tempa House Columnist'

describe('EditorialByline', () => {
  it('renders nothing for an ordinary member', () => {
    for (const title of [null, undefined, '', '   ']) expect(renderToStaticMarkup(<EditorialByline title={title} />)).toBe('')
  })

  it('a quill + the title, in the wordmark serif, small caps, brand plum', () => {
    const html = renderToStaticMarkup(<EditorialByline title={TITLE} />)
    expect(html).toContain(TITLE)
    const svg = html.match(/<svg[^>]*>/)?.[0] ?? ''
    expect(svg).toContain('aria-hidden="true"')
    expect(svg).toContain('width="14"')
    expect(svg).toContain('stroke="currentColor"')
    for (const cls of ['font-serif', 'text-plum', '[font-variant-caps:small-caps]', 'tracking-[0.08em]', 'text-[0.75rem]', 'font-normal']) {
      expect(html).toContain(cls)
    }
  })

  it('reads as a byline, never a badge: no fill, no border box, no pill', () => {
    const html = renderToStaticMarkup(<EditorialByline title={TITLE} />)
    expect(html).not.toMatch(/\bbg-|\bborder\b|border-(?!t)|rounded/)
  })

  it('the profile-page hairline is a top rule only, in low-opacity plum', () => {
    const html = renderToStaticMarkup(<EditorialByline title={TITLE} rule />)
    expect(html).toContain('border-t border-plum/25')
    expect(html).not.toMatch(/\bbg-|rounded/)
  })
})

describe('surfaces', () => {
  const larkspur = resolveDispatchIdentity({
    publishedAs: 'member', authorId: 'm-1', authorPseudonym: 'Lady Larkspur', authorCountry: 'United Kingdom', authorEditorialTitle: TITLE,
  })
  const ordinary = resolveDispatchIdentity({ publishedAs: 'member', authorId: 'm-2', authorPseudonym: 'Evening Quill', authorCountry: 'Kenya' })

  it('an ordinary member identity is exactly as before (no editorial key at all)', () => {
    expect(ordinary).toEqual({ kind: 'member', authorId: 'm-2', name: 'Evening Quill', country: 'Kenya', markUrl: null })
    expect(renderToStaticMarkup(<DispatchIdentityLabel identity={ordinary} />)).not.toContain('data-editorial-byline')
  })

  it('Tempa/Sponsored Dispatches never carry it, even if a title were supplied', () => {
    const tempa = resolveDispatchIdentity({ publishedAs: 'tempa', authorId: 'a', authorPseudonym: 'x', authorCountry: null, authorEditorialTitle: TITLE })
    expect(renderToStaticMarkup(<DispatchIdentityLabel identity={tempa} />)).not.toContain(TITLE)
  })

  it('Board / Dispatch bylines — linked and anonymous', () => {
    for (const html of [
      renderToStaticMarkup(<DispatchIdentityLabel identity={larkspur} />),
      renderToStaticMarkup(<DispatchIdentityLabel identity={larkspur} size="md" linkable={false} />),
      renderToStaticMarkup(<DispatchAuthorLink authorId="m-1" authorPseudonym="Lady Larkspur" authorCountry={null} authorEditorialTitle={TITLE} />),
    ]) {
      expect(html.indexOf('Lady Larkspur')).toBeLessThan(html.indexOf(TITLE))
    }
  })

  it('Worth Knowing preserves the byline and Room profile link', () => {
    const html = renderToStaticMarkup(
      <RecommendedMindCard mind={{ userId: 'm-1', pseudonym: 'Lady Larkspur', country: 'UK', genderDisplay: null, ageRange: '35-44', editorialTitle: TITLE }} />
    )
    expect(html).toContain(TITLE)
    expect(html).toContain('href="/room/m-1?source=worth_knowing"')
  })

  it('People discovery card', () => {
    const html = renderToStaticMarkup(
      <DiscoveryResults
        entries={[{
          userId: 'm-1', pseudonym: 'Lady Larkspur', country: 'UK', genderDisplay: null, ageRange: '35-44', markUrl: null,
          response: { id: 'a-1', body: 'An answer.', prompt: 'A question?' }, editorialTitle: TITLE,
        }]}
      />
    )
    expect(html.indexOf('Lady Larkspur')).toBeLessThan(html.indexOf(TITLE))
  })

  it('public /dispatches card', () => {
    const html = renderToStaticMarkup(
      <PublicDispatchCard
        dispatch={{
          slug: 'a-b-0123456789ab', title: 'On Letters', bodyPreview: 'Words.', publishedAt: '2026-09-30T09:00:00Z', lastModified: '2026-09-30T09:00:00Z',
          topics: [], identity: { kind: 'member', name: 'Lady Larkspur', country: 'UK', editorialTitle: TITLE },
        }}
      />
    )
    expect(html.indexOf('Lady Larkspur')).toBeLessThan(html.indexOf(TITLE))
  })
})
