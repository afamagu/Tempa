import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveDispatchIdentity, type PublishedAs } from '@/lib/dispatch-identity'
import type { SharedDispatch } from '@/lib/dispatches'

// generateMetadata for /d/[shareToken] against the real identity rules,
// with get_shared_dispatch mocked at the lib boundary.

let current: SharedDispatch | null = null
const loads: string[] = []
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
// next/font only works inside the Next compiler; the root layout's
// metadata/viewport exports are what's under test here.
vi.mock('next/font/google', () => ({ Geist: () => ({ variable: 'v' }), Newsreader: () => ({ variable: 'v' }) }))
vi.mock('@/lib/dispatches', async (orig) => ({
  ...(await orig<typeof import('@/lib/dispatches')>()),
  getSharedDispatch: async (_s: unknown, token: string) => {
    loads.push(token)
    return current
  },
}))

const { generateMetadata } = await import('./page')

function shared(kind: PublishedAs): SharedDispatch {
  // What get_shared_dispatch returns: never the creating admin for official rows.
  const name = kind === 'tempa' ? 'Tempa' : kind === 'sponsored' ? 'Acme Paper' : 'Quiet Harbour'
  return {
    id: 'd-1',
    title: 'Welcome to Tempa',
    body: 'PRIVATE BODY TEXT that must never reach social metadata.',
    publishedAt: '2026-09-25T12:00:00Z',
    authorPseudonym: name,
    authorCountry: kind === 'member' ? 'Kenya' : null,
    topics: [],
    moments: [],
    postcard: null,
    identity: resolveDispatchIdentity({ publishedAs: kind, authorId: '', authorPseudonym: name, authorCountry: null, sponsorName: kind === 'sponsored' ? 'Acme Paper' : null }),
  }
}

const meta = async (token = 'tok-1') => generateMetadata({ params: Promise.resolve({ shareToken: token }) })
const text = (m: unknown) => JSON.stringify(m)

beforeEach(() => {
  current = null
  loads.length = 0
})

describe('/d/[shareToken] link-preview metadata', () => {
  it('official Tempa: "{title} — Tempa", "A Dispatch from Tempa.", no admin identity, no body', async () => {
    current = shared('tempa')
    const m = await meta()
    expect(m.title).toBe('Welcome to Tempa — Tempa')
    expect(m.description).toBe('A Dispatch from Tempa.')
    expect(m.openGraph).toMatchObject({ type: 'article', siteName: 'Tempa', title: 'Welcome to Tempa — Tempa', description: 'A Dispatch from Tempa.', url: '/d/tok-1' })
    expect(text(m)).not.toMatch(/by Tempa|Afam|admin|author_id|PRIVATE BODY/)
  })

  it('member: attributed to the member, unchanged title format', async () => {
    current = shared('member')
    const m = await meta()
    expect(m.title).toBe('Welcome to Tempa — by Quiet Harbour · Tempa')
    expect(m.description).toBe('A Dispatch shared on Tempa.')
    expect(text(m)).not.toContain('PRIVATE BODY')
  })

  it('Sponsored: clearly says Sponsored and names the sponsor', async () => {
    current = shared('sponsored')
    const m = await meta()
    expect(m.title).toBe('Welcome to Tempa — Sponsored by Acme Paper · Tempa')
    expect(m.description).toBe('Sponsored Dispatch from Acme Paper on Tempa.')
    expect(text(m.openGraph)).toContain('Sponsored')
  })

  it('Twitter/X large-image card for every available Dispatch', async () => {
    for (const kind of ['tempa', 'member', 'sponsored'] as const) {
      current = shared(kind)
      expect((await meta()).twitter).toMatchObject({ card: 'summary_large_image' })
    }
  })

  it('noindex/nofollow on the shared-token route (available and unavailable)', async () => {
    current = shared('tempa')
    expect((await meta()).robots).toMatchObject({ index: false, follow: false })
    current = null
    expect((await meta()).robots).toMatchObject({ index: false, follow: false })
  })

  it('unavailable/revoked: neutral title, nothing about any Dispatch', async () => {
    current = null
    const m = await meta('revoked-token')
    expect(m.title).toBe('Dispatch unavailable — Tempa')
    expect(m.openGraph).toBeUndefined()
    expect(m.description).toBeUndefined()
  })

  it('canonical URL is the public token path (made absolute by metadataBase)', async () => {
    current = shared('member')
    expect((await meta('abc')).alternates).toEqual({ canonical: '/d/abc' })
  })
})

describe('share image + root presence', () => {
  it('share-image routes exist for OG and Twitter/X at 1200×630, both segments', async () => {
    for (const mod of [
      await import('./opengraph-image'),
      await import('./twitter-image'),
      await import('@/app/opengraph-image'),
      await import('@/app/twitter-image'),
    ]) {
      expect(mod.size).toEqual({ width: 1200, height: 630 })
      expect(mod.contentType).toBe('image/png')
      expect(mod.alt).toBeTruthy()
    }
  })

  it('root metadata: Tempa defaults with an absolute production origin', async () => {
    const { metadata, viewport } = await import('@/app/layout')
    expect(String(metadata.metadataBase)).toBe('https://jointempa.com/')
    expect(metadata).toMatchObject({
      title: 'Tempa',
      applicationName: 'Tempa',
      description: 'Meet people through what they think, write and choose to share.',
      openGraph: { siteName: 'Tempa', type: 'website' },
      twitter: { card: 'summary_large_image' },
    })
    expect(viewport.themeColor).toBe('#f7f2e7')
  })

  it('manifest: minimal home-screen presence, no PWA features', async () => {
    const m = (await import('@/app/manifest')).default()
    expect(m).toMatchObject({ name: 'Tempa', short_name: 'Tempa', start_url: '/', display: 'standalone', background_color: '#f7f2e7', theme_color: '#f7f2e7' })
    expect(m.icons?.map((i) => i.purpose)).toEqual(['any', 'any', 'maskable'])
    expect(Object.keys(m)).not.toContain('serviceworker')
  })
})
