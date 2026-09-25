import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import SharedDispatchView from './shared-dispatch-view'
import type { SharedDispatch } from '@/lib/dispatches'
import { resolveDispatchIdentity } from '@/lib/dispatch-identity'

// The anonymous /d/[shareToken] reader for official Tempa and Sponsored
// Dispatches — the first Tempa acquisition Dispatch is shared here.

const postcardVersion = {
  title: 'Harbour',
  location: 'Lagos',
  collection: 'Tempa',
  postmarkText: 'Tempa',
  footerText: '',
  frontImagePath: 'harbour.jpg',
  motionSrc: null,
  durationSeconds: null,
  revealLineAlignment: null,
}

function shared(publishedAs: 'member' | 'tempa' | 'sponsored', extra: Partial<SharedDispatch> = {}): SharedDispatch {
  // Exactly what get_shared_dispatch returns for each identity: the
  // creating admin's pseudonym/country never arrive for tempa/sponsored.
  const authorPseudonym = publishedAs === 'tempa' ? 'Tempa' : publishedAs === 'sponsored' ? 'Acme Paper' : 'Quiet Harbour'
  return {
    id: 'd-1',
    title: 'Welcome to Tempa',
    body: 'A slower kind of company.\n\nWrite to someone.',
    publishedAt: '2026-09-25T12:00:00Z',
    authorPseudonym,
    authorCountry: publishedAs === 'member' ? 'Kenya' : null,
    topics: [],
    moments: [],
    postcard: {
      revealLine: 'Hello',
      backMessage: 'Warmly',
      senderPseudonymSnapshot: authorPseudonym,
      version: postcardVersion,
    },
    identity: resolveDispatchIdentity({
      publishedAs,
      authorId: '',
      authorPseudonym,
      authorCountry: publishedAs === 'member' ? 'Kenya' : null,
      sponsorName: publishedAs === 'sponsored' ? 'Acme Paper' : null,
      sponsorCtaUrl: publishedAs === 'sponsored' ? 'https://acme.example/paper' : null,
    }),
    ...extra,
  }
}

describe('external shared reader — official Tempa Dispatch', () => {
  const html = renderToStaticMarkup(<SharedDispatchView dispatch={shared('tempa')} isAuthenticated={false} />)

  it('identity = Tempa emblem + "Tempa"; no member Mark/flag/profile link', () => {
    expect(html).toContain('tempa-emblem.png')
    expect(html).toContain('data-dispatch-identity="tempa"')
    expect(html).not.toContain('/minds/')
  })

  it('full Dispatch still readable, Join Tempa CTA remains', () => {
    expect(html).toContain('Welcome to Tempa')
    expect(html).toContain('A slower kind of company.')
    expect(html).toContain('href="/sign-in?intent=join"')
    expect(html).toContain('Join Tempa')
  })

  it('no Sponsored disclosure on Tempa content', () => {
    expect(html).not.toContain('data-dispatch-identity="sponsored"')
  })
})

describe('external shared reader — Sponsored Dispatch', () => {
  const html = renderToStaticMarkup(<SharedDispatchView dispatch={shared('sponsored')} isAuthenticated={false} />)

  it('labelled Sponsored with the sponsor name, never Tempa as author', () => {
    expect(html).toContain('data-dispatch-identity="sponsored"')
    expect(html).toContain('Sponsored')
    expect(html).toContain('Acme Paper')
    expect(html).not.toContain('data-dispatch-identity="tempa"')
  })

  it('restrained external CTA with sponsored rel attributes', () => {
    expect(html).toContain('href="https://acme.example/paper"')
    expect(html).toContain('rel="sponsored noopener noreferrer"')
    expect(html).toContain('Learn more')
  })
})

describe('external shared reader — member Dispatch unchanged', () => {
  it('still renders the member pseudonym + country flag path, no official identity', () => {
    const html = renderToStaticMarkup(<SharedDispatchView dispatch={shared('member')} isAuthenticated={false} />)
    expect(html).toContain('Quiet Harbour')
    expect(html).not.toContain('data-dispatch-identity=')
  })
})

describe('share page metadata', () => {
  const page = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
  it('uses identity-aware titles (never "by Tempa · Tempa") and still one get_shared_dispatch call', () => {
    expect(page).toContain('dispatchShareTitle(dispatch.title, dispatch.identity)')
    expect(page).not.toContain('— by ${dispatch.authorPseudonym} · Tempa')
    expect(page).toContain('const loadSharedDispatch = cache(')
  })
})
