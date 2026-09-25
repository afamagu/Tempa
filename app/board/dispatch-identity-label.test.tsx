import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveDispatchIdentity } from '@/lib/dispatch-identity'
import DispatchIdentityLabel, { SponsorCta } from './dispatch-identity-label'
import DispatchCard from './dispatch-card'
import type { DispatchListItem } from '@/lib/dispatches'

const admin = { authorId: 'admin-1', authorPseudonym: 'Afam Personal', authorCountry: 'Nigeria', authorMarkUrl: null }
const member = resolveDispatchIdentity({ publishedAs: 'member', authorId: 'm-1', authorPseudonym: 'Quiet Harbour', authorCountry: 'Kenya' })
const tempa = resolveDispatchIdentity({ ...admin, publishedAs: 'tempa' })
const sponsored = resolveDispatchIdentity({ ...admin, publishedAs: 'sponsored', sponsorName: 'Acme Paper', sponsorCtaUrl: 'https://acme.example', sponsorCtaLabel: 'Shop paper' })

describe('DispatchIdentityLabel', () => {
  it('member: unchanged profile link with pseudonym + country', () => {
    const html = renderToStaticMarkup(<DispatchIdentityLabel identity={member} />)
    expect(html).toContain('href="/minds/m-1"')
    expect(html).toContain('Quiet Harbour')
    expect(html).toContain('Kenya')
  })

  it('Tempa: approved emblem asset + "Tempa", no link, no country, no admin', () => {
    const html = renderToStaticMarkup(<DispatchIdentityLabel identity={tempa} />)
    expect(html).toContain('tempa-emblem.png')
    expect(html).toContain('>Tempa<')
    expect(html).not.toContain('href=')
    expect(html).not.toMatch(/Afam|Nigeria|admin-1|\/minds\//)
  })

  it('Sponsored: "Sponsored" disclosure + sponsor name, no link, not Tempa, no admin', () => {
    const html = renderToStaticMarkup(<DispatchIdentityLabel identity={sponsored} />)
    expect(html).toContain('Sponsored')
    expect(html).toContain('Acme Paper')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('tempa-emblem')
    expect(html).not.toMatch(/Afam|Nigeria|admin-1/)
  })

  it('anonymous reader: a member identity can be rendered without a profile link', () => {
    const html = renderToStaticMarkup(<DispatchIdentityLabel identity={member} linkable={false} />)
    expect(html).not.toContain('href=')
    expect(html).toContain('Quiet Harbour')
  })
})

describe('SponsorCta', () => {
  it('is external, new tab, rel="sponsored noopener noreferrer"', () => {
    const html = renderToStaticMarkup(<SponsorCta identity={sponsored} />)
    expect(html).toContain('href="https://acme.example/"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="sponsored noopener noreferrer"')
    expect(html).toContain('Shop paper')
  })

  it('renders nothing for member/Tempa rows or an unsafe URL', () => {
    expect(renderToStaticMarkup(<SponsorCta identity={member} />)).toBe('')
    expect(renderToStaticMarkup(<SponsorCta identity={tempa} />)).toBe('')
    const unsafe = resolveDispatchIdentity({ ...admin, publishedAs: 'sponsored', sponsorName: 'X', sponsorCtaUrl: 'javascript:alert(1)' })
    expect(renderToStaticMarkup(<SponsorCta identity={unsafe} />)).toBe('')
  })
})

describe('Board card uses the canonical identity', () => {
  const card = (identity: typeof member, publishedAs: 'member' | 'tempa' | 'sponsored'): DispatchListItem => ({
    id: 'd-1',
    authorId: 'admin-1',
    authorPseudonym: identity.name,
    authorCountry: null,
    title: 'A title',
    body: 'Body text',
    publishedAt: '2026-09-25T12:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    publishedAs,
    identity,
  })

  it('Tempa card: emblem + Tempa, never the admin profile link', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={card(tempa, 'tempa')} />)
    expect(html).toContain('>Tempa<')
    expect(html).not.toContain('href="/minds/admin-1"')
  })

  it('Sponsored card: unmistakably labelled Sponsored', () => {
    const html = renderToStaticMarkup(<DispatchCard dispatch={card(sponsored, 'sponsored')} />)
    expect(html).toContain('Sponsored')
    expect(html).toContain('Acme Paper')
    expect(html).not.toContain('href="/minds/admin-1"')
  })
})
