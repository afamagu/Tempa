import { describe, it, expect } from 'vitest'
import {
  dispatchShareContextLine,
  dispatchShareDescription,
  dispatchShareText,
  dispatchShareTitle,
  hasMemberIdentity,
  resolveDispatchIdentity,
  safeSponsorUrl,
  toPublishedAs,
} from './dispatch-identity'

const base = { authorId: 'admin-1', authorPseudonym: 'Afam Personal', authorCountry: 'Nigeria', authorMarkUrl: 'https://x/m.png' }

describe('resolveDispatchIdentity — one canonical resolution', () => {
  it('member: the author profile identity, exactly as before', () => {
    expect(resolveDispatchIdentity({ ...base, publishedAs: 'member' })).toEqual({
      kind: 'member',
      authorId: 'admin-1',
      name: 'Afam Personal',
      country: 'Nigeria',
      markUrl: 'https://x/m.png',
    })
  })

  it('tempa: "Tempa" only — never the creating admin, never "A member"', () => {
    const id = resolveDispatchIdentity({ ...base, publishedAs: 'tempa' })
    expect(id).toEqual({ kind: 'tempa', name: 'Tempa' })
    expect(JSON.stringify(id)).not.toMatch(/Afam|Nigeria|admin-1|m\.png|A member/)
  })

  it('sponsored: sponsor name + disclosure, never the admin, never Tempa', () => {
    const id = resolveDispatchIdentity({ ...base, publishedAs: 'sponsored', sponsorName: 'Acme Paper', sponsorCtaUrl: 'https://acme.example/p', sponsorCtaLabel: '' })
    expect(id).toEqual({ kind: 'sponsored', name: 'Acme Paper', sponsor: { name: 'Acme Paper', ctaUrl: 'https://acme.example/p', ctaLabel: 'Learn more' } })
    expect(JSON.stringify(id)).not.toMatch(/Afam|Nigeria|admin-1|"Tempa"/)
  })

  it('member-identity actions only apply to member rows', () => {
    expect(hasMemberIdentity(resolveDispatchIdentity({ ...base, publishedAs: 'member' }))).toBe(true)
    expect(hasMemberIdentity(resolveDispatchIdentity({ ...base, publishedAs: 'tempa' }))).toBe(false)
    expect(hasMemberIdentity(resolveDispatchIdentity({ ...base, publishedAs: 'sponsored', sponsorName: 'Acme' }))).toBe(false)
  })

  it('unknown/absent published_as is treated as member (pre-migration rows)', () => {
    expect(toPublishedAs(undefined)).toBe('member')
    expect(toPublishedAs('admin')).toBe('member')
    expect(toPublishedAs('tempa')).toBe('tempa')
  })
})

describe('safeSponsorUrl — https only', () => {
  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<b>x</b>'],
    ['http://acme.example'],
    ['tempa://open'],
    ['https://localhost'],
    ['https://user:pw@acme.example'],
    ['not a url'],
    [''],
  ])('rejects %s', (url) => {
    expect(safeSponsorUrl(url)).toBeNull()
  })

  it('accepts a normal https URL', () => {
    expect(safeSponsorUrl('https://acme.example/paper?x=1')).toBe('https://acme.example/paper?x=1')
  })

  it('a stored unsafe URL renders no CTA at all', () => {
    const id = resolveDispatchIdentity({ ...base, publishedAs: 'sponsored', sponsorName: 'Acme', sponsorCtaUrl: 'javascript:alert(1)', sponsorCtaLabel: 'Click' })
    expect(id.kind === 'sponsored' && id.sponsor).toEqual({ name: 'Acme', ctaUrl: null, ctaLabel: null })
  })
})

describe('share metadata / share-sheet text', () => {
  const member = resolveDispatchIdentity({ ...base, publishedAs: 'member' })
  const tempa = resolveDispatchIdentity({ ...base, publishedAs: 'tempa' })
  const sponsored = resolveDispatchIdentity({ ...base, publishedAs: 'sponsored', sponsorName: 'Acme' })

  it('member unchanged: "{title} — by {pseudonym} · Tempa"', () => {
    expect(dispatchShareTitle('Hello', member)).toBe('Hello — by Afam Personal · Tempa')
    expect(dispatchShareText('Hello', member)).toBe('Hello — by Afam Personal on Tempa')
  })

  it('Tempa: "{title} — Tempa", never "by Tempa · Tempa"', () => {
    expect(dispatchShareTitle('Welcome', tempa)).toBe('Welcome — Tempa')
    expect(dispatchShareTitle('Welcome', tempa)).not.toContain('by Tempa')
  })

  it('Sponsored keeps its sponsor disclosure', () => {
    expect(dispatchShareTitle('Paper', sponsored)).toBe('Paper — Sponsored by Acme · Tempa')
    expect(dispatchShareText('Paper', sponsored)).toContain('Sponsored by Acme')
  })
})

describe('link-preview description / image context', () => {
  const id = (publishedAs: 'member' | 'tempa' | 'sponsored') =>
    resolveDispatchIdentity({ ...base, publishedAs, sponsorName: 'Acme' })

  it('never the body; publication-aware and short', () => {
    expect(dispatchShareDescription(id('tempa'))).toBe('A Dispatch from Tempa.')
    expect(dispatchShareDescription(id('member'))).toBe('A Dispatch shared on Tempa.')
    expect(dispatchShareDescription(id('sponsored'))).toBe('Sponsored Dispatch from Acme on Tempa.')
  })

  it('image context line never names the creating admin for official rows', () => {
    expect(dispatchShareContextLine(id('tempa'))).toBe('A Dispatch from Tempa')
    expect(dispatchShareContextLine(id('sponsored'))).toBe('Sponsored · Acme')
    expect(dispatchShareContextLine(id('tempa'))).not.toContain('Afam')
  })
})
