import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { RICH_BODY_MARKER } from '@/lib/letter-editor-doc'
import {
  dispatchDescription,
  dispatchPlainText,
  getPublicDispatch,
  jsonLdScriptContent,
  listPublicDispatches,
  publicDispatchJsonLd,
  publicDispatchMetadata,
  publicDispatchUrl,
  setDispatchWebPublic,
  UNAVAILABLE_DISPATCH_METADATA,
  WEB_PUBLIC_COPY,
  type PublicDispatch,
} from '@/lib/public-dispatches'

// Public Dispatch web pages (docs/public-dispatch-web-pages.md). Database
// behaviour (who can make what public, every non-public state, photos,
// slugs, backfill) is proven against the migration on PGlite — see
// lib/__tests__/publicDispatchWebPagesMigration.test.ts and the PR.

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')
const SLUG = 'my-mother-never-apologised-she-cooked-a8f3c29d41b7'

const rpcRow = (over: Record<string, unknown> = {}) => ({
  web_slug: SLUG,
  title: 'My mother never apologised. She cooked.',
  body: 'Every evening she made jollof.\n\nThat was the apology.',
  published_at: '2026-09-01T10:00:00.000Z',
  content_updated_at: null,
  author_pseudonym: 'Alice Quill',
  author_country: 'Nigeria',
  topics: ['family'],
  moments: [{ position: 0, image_path: 'author-folder/kitchen.jpg' }],
  postcard: null,
  published_as: 'member',
  sponsor_name: null,
  sponsor_cta_label: null,
  sponsor_cta_url: null,
  ...over,
})
const fakeSupabase = (rows: unknown[] | null, error: unknown = null) => {
  const rpc = vi.fn(async () => ({ data: rows, error }))
  const storage = { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) }
  return { client: { rpc, storage } as never, rpc }
}
const load = async (over: Record<string, unknown> = {}) => (await getPublicDispatch(fakeSupabase([rpcRow(over)]).client, SLUG)) as PublicDispatch

describe('excerpt / meta description', () => {
  it('strips the rich marker and **bold** / _italic_ marks, honouring escapes', () => {
    expect(dispatchPlainText(`${RICH_BODY_MARKER}She **always** said _later_.\n\nA \\*star\\* and a snake\\_case.`))
      .toBe('She always said later. A *star* and a snake_case.')
    expect(dispatchPlainText('Plain **not rich** _stays_')).toBe('Plain **not rich** _stays_')
  })

  it('never cuts a word in half and stays within 155 characters', () => {
    const long = 'word '.repeat(80)
    const d = dispatchDescription(long)
    expect(d.length).toBeLessThanOrEqual(155)
    expect(d.endsWith('…')).toBe(true)
    expect(d.replace('…', '').trim().split(' ').every((w) => w === 'word')).toBe(true)
    expect(dispatchDescription('Short.')).toBe('Short.')
  })
})

describe('reading a public Dispatch', () => {
  it('refuses malformed slugs without calling the database', async () => {
    const { client, rpc } = fakeSupabase([rpcRow()])
    for (const bad of ['', 'UPPER-abc123', "x' or 1=1", 'a'.repeat(81), '../etc']) expect(await getPublicDispatch(client, bad)).toBeNull()
    expect(rpc).not.toHaveBeenCalled()
  })

  it('an unavailable slug (no row / error) is null — indistinguishable', async () => {
    expect(await getPublicDispatch(fakeSupabase([]).client, SLUG)).toBeNull()
    expect(await getPublicDispatch(fakeSupabase(null, { message: 'x' }).client, SLUG)).toBeNull()
  })

  it('maps the article, keyed by its slug — never an internal id (nested Moments included)', async () => {
    const d = await load()
    expect(d.slug).toBe(SLUG)
    expect(d.id).toBe(SLUG)
    expect(d.moments.map((m) => ({ id: m.id, position: m.position }))).toEqual([{ id: `${SLUG}-moment-1`, position: 0 }])
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    expect(JSON.stringify(d)).not.toMatch(UUID)
    expect(d.body).toContain('jollof')
    expect(d.identity).toMatchObject({ kind: 'member', name: 'Alice Quill' })
    expect(d.datePublished).toBe('2026-09-01T10:00:00.000Z')
    expect(d.dateModified).toBe('2026-09-01T10:00:00.000Z')
  })

  it('a later content edit becomes dateModified; datePublished never moves', async () => {
    const d = await load({ content_updated_at: '2026-09-20T08:00:00.000Z' })
    expect(d.datePublished).toBe('2026-09-01T10:00:00.000Z')
    expect(d.dateModified).toBe('2026-09-20T08:00:00.000Z')
  })
})

describe('metadata', () => {
  it('unique title, clean description, exactly one absolute canonical, indexable', async () => {
    const m = publicDispatchMetadata(await load())
    expect(m.title).toEqual({ absolute: 'My mother never apologised. She cooked. — by Alice Quill · Tempa' })
    expect(m.description).toBe('Every evening she made jollof. That was the apology.')
    expect(m.alternates).toEqual({ canonical: `https://jointempa.com/dispatches/${SLUG}` })
    expect(m.robots).toEqual({ index: true, follow: true })
  })

  it('Open Graph article + large Twitter card, with publish/modify times', async () => {
    const m = publicDispatchMetadata(await load({ content_updated_at: '2026-09-20T08:00:00.000Z' }))
    expect(m.openGraph).toMatchObject({
      type: 'article', siteName: 'Tempa', url: publicDispatchUrl(SLUG),
      title: 'My mother never apologised. She cooked. — by Alice Quill · Tempa',
      publishedTime: '2026-09-01T10:00:00.000Z', modifiedTime: '2026-09-20T08:00:00.000Z',
    })
    expect(m.twitter).toMatchObject({ card: 'summary_large_image' })
  })

  it('an unavailable Dispatch gets noindex and nothing of its content', () => {
    expect(UNAVAILABLE_DISPATCH_METADATA.robots).toMatchObject({ index: false, follow: false })
    const json = JSON.stringify(UNAVAILABLE_DISPATCH_METADATA)
    expect(json).not.toMatch(/openGraph|description|canonical/)
  })
})

describe('JSON-LD (BlogPosting)', () => {
  it('describes exactly the visible article, truthfully', async () => {
    const ld = publicDispatchJsonLd(await load({ content_updated_at: '2026-09-20T08:00:00.000Z' }))
    expect(ld).toMatchObject({
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: 'My mother never apologised. She cooked.',
      description: 'Every evening she made jollof. That was the apology.',
      datePublished: '2026-09-01T10:00:00.000Z', dateModified: '2026-09-20T08:00:00.000Z',
      mainEntityOfPage: { '@type': 'WebPage', '@id': publicDispatchUrl(SLUG) },
      image: [`${publicDispatchUrl(SLUG)}/opengraph-image`],
      author: { '@type': 'Person', name: 'Alice Quill' },
      publisher: { '@type': 'Organization', name: 'Tempa' },
      keywords: 'family',
    })
    // public identity only: no profile URL, no country, no ids
    expect(JSON.stringify(ld)).not.toMatch(/minds\/|Nigeria|authorId|author_id/)
  })

  it('official and sponsored Dispatches are attributed to organisations, never the creating admin', async () => {
    expect(publicDispatchJsonLd(await load({ published_as: 'tempa', author_pseudonym: 'Tempa', author_country: null })).author)
      .toEqual({ '@type': 'Organization', name: 'Tempa', url: 'https://jointempa.com' })
    expect(publicDispatchJsonLd(await load({ published_as: 'sponsored', author_pseudonym: 'Paper Co', sponsor_name: 'Paper Co' })).author)
      .toEqual({ '@type': 'Organization', name: 'Paper Co' })
  })

  it('a house account is attributed as "Lady Larkspur, Tempa House Columnist" — metadata and JSON-LD', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'editorial_bylines'
        ? { data: [{ pseudonym_key: 'ladylarkspur', editorial_title: 'Tempa House Columnist' }], error: null }
        : { data: [rpcRow({ author_pseudonym: 'Lady Larkspur', author_country: 'United Kingdom' })], error: null }
    )
    const storage = { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) }
    const d = (await getPublicDispatch({ rpc, storage } as never, SLUG)) as PublicDispatch
    expect(d.identity).toMatchObject({ kind: 'member', name: 'Lady Larkspur', editorialTitle: 'Tempa House Columnist' })

    const m = publicDispatchMetadata(d)
    expect(m.authors).toEqual([{ name: 'Lady Larkspur, Tempa House Columnist' }])
    expect(m.openGraph).toMatchObject({ authors: ['Lady Larkspur, Tempa House Columnist'] })

    expect(publicDispatchJsonLd(d).author).toEqual({
      '@type': 'Person',
      name: 'Lady Larkspur, Tempa House Columnist',
      jobTitle: 'Tempa House Columnist',
      worksFor: { '@type': 'Organization', name: 'Tempa', url: 'https://jointempa.com' },
    })
  })

  it('an ordinary member gets no authors metadata and a plain Person author (unchanged)', async () => {
    const d = await load()
    expect(publicDispatchMetadata(d)).not.toHaveProperty('authors')
    expect(publicDispatchMetadata(d).openGraph).not.toHaveProperty('authors')
    expect(publicDispatchJsonLd(d).author).toEqual({ '@type': 'Person', name: 'Alice Quill' })
  })

  it('script content can never close the script element', () => {
    const out = jsonLdScriptContent({ headline: '</script><script>alert(1)</script>' })
    expect(out).not.toContain('<')
    expect(JSON.parse(out).headline).toBe('</script><script>alert(1)</script>')
  })
})

describe('the page (server HTML)', () => {
  const rpc = vi.fn()
  beforeEach(() => {
    vi.resetModules()
    rpc.mockReset()
    vi.doMock('@/lib/supabase/anon', () => ({
      createAnonClient: () => ({ rpc, storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) } }),
    }))
    vi.doMock('next/headers', () => ({ cookies: async () => ({ getAll: () => [] }) }))
    vi.doMock('next/navigation', () => ({
      notFound: () => { throw new Error('NEXT_NOT_FOUND') },
      useRouter: () => ({ push: () => {}, refresh: () => {} }),
    }))
  })

  it('anonymous visitors get the full article + JSON-LD in the server-rendered HTML', async () => {
    rpc.mockResolvedValue({ data: [rpcRow()], error: null })
    const { default: Page, generateMetadata } = await import('@/app/dispatches/[slug]/page')
    const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ slug: SLUG }) }))
    expect(html).toContain('My mother never apologised. She cooked.')
    expect(html).toContain('Every evening she made jollof.')
    expect(html).toContain('Alice Quill')
    expect(html).toContain('Join Tempa to write to Alice Quill.')
    expect(html).toContain('<script type="application/ld+json">')
    const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
    expect(ld.headline).toBe('My mother never apologised. She cooked.')
    expect(html).not.toMatch(/\/minds\/|00000000-/)
    const meta = await generateMetadata({ params: Promise.resolve({ slug: SLUG }) })
    expect(meta.alternates).toEqual({ canonical: `https://jointempa.com/dispatches/${SLUG}` })
    expect(rpc).toHaveBeenCalledWith('get_public_dispatch', { p_slug: SLUG })
  }, 20_000)

  it('anything not public on the web right now → 404 + noindex, and nothing of it in the page or metadata', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { default: Page, generateMetadata } = await import('@/app/dispatches/[slug]/page')
    await expect(Page({ params: Promise.resolve({ slug: SLUG }) })).rejects.toThrow('NEXT_NOT_FOUND')
    const meta = await generateMetadata({ params: Promise.resolve({ slug: SLUG }) })
    expect(meta).toEqual(UNAVAILABLE_DISPATCH_METADATA)
  })

  it('the sitemap lists exactly the public Dispatches with honest lastmod, plus the public pages', async () => {
    rpc.mockResolvedValue({
      data: [{ web_slug: SLUG, published_at: '2026-09-01T10:00:00Z', last_modified: '2026-09-20T08:00:00Z' }, { web_slug: 'BAD SLUG', last_modified: 'x' }],
      error: null,
    })
    const { default: sitemap } = await import('@/app/sitemap')
    const entries = await sitemap()
    expect(rpc).toHaveBeenCalledWith('list_public_dispatches')
    expect(entries.filter((e) => e.url.includes('/dispatches/'))).toEqual([{ url: publicDispatchUrl(SLUG), lastModified: '2026-09-20T08:00:00Z' }])
    expect(entries.some((e) => e.url === 'https://jointempa.com/sign-in')).toBe(true)
    expect(entries.every((e) => e.url.startsWith('https://jointempa.com/'))).toBe(true)
  })

  it('a database failure never breaks the sitemap', async () => {
    rpc.mockRejectedValue(new Error('down'))
    const { default: sitemap } = await import('@/app/sitemap')
    expect((await sitemap()).every((e) => !e.url.includes('/dispatches/'))).toBe(true)
  })
})

describe('share image and media', () => {
  it('the article image is Tempa’s generated card (title + public identity) — never a member photo or storage URL', () => {
    const src = read('app/_og/public-dispatch-image.tsx')
    expect(src).toContain('getPublicDispatch(createAnonClient(), slug)')
    expect(src).not.toMatch(/imageUrl|image_path|createSigned|storage/)
    expect(read('app/dispatches/[slug]/opengraph-image.tsx')).toContain("export const dynamic = 'force-dynamic'")
  })

  it('JSON-LD uses the only dangerouslySetInnerHTML in the app, always through the escaping helper', () => {
    const walk = (dir: string): string[] =>
      readdirSync(path.join(root, dir)).flatMap((n) => {
        const rel = path.join(dir, n)
        return statSync(path.join(root, rel)).isDirectory() ? walk(rel) : /\.tsx$/.test(n) && !/\.test\.tsx$/.test(n) ? [rel] : []
      })
    const users = walk('app').filter((f) => read(f).includes('dangerouslySetInnerHTML={'))
    expect(users.map((f) => f.replace(/\\/g, '/'))).toEqual(['app/dispatches/[slug]/page.tsx'])
    expect(read('app/dispatches/[slug]/page.tsx')).toContain('dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(')
  })
})

describe('the author’s choice', () => {
  it('composer copy says plainly that Public means the open web', () => {
    expect(WEB_PUBLIC_COPY.on).toBe('Anyone can read this Dispatch on the web. Public Dispatches may appear in search engines.')
    const composer = read('app/board/dispatch-composer.tsx')
    expect(composer).toContain('{webPublic ? WEB_PUBLIC_COPY.on : WEB_PUBLIC_COPY.off}')
    // members default to members-only; official/sponsored default to public
    expect(composer).toContain('const initialWebPublic = isEdit ? existingDispatch?.webPublic ?? null : publication ? true : false')
  })

  it('the composer sends the requested web state WITH the save (one transaction) — no separate follow-up call', () => {
    const composer = read('app/board/dispatch-composer.tsx')
    expect(composer).toContain('const requestedWeb = showWebChoice ? webPublic : undefined')
    expect(composer.match(/webPublic: requestedWeb,/g)).toHaveLength(4)
    expect(composer).not.toContain('setDispatchWebPublic')
    // a web-visibility refusal is shown, and the composer stays put (no navigation)
    const refusal = composer.indexOf('const webRefusal = webVisibilityRefusal(submitError?.message)')
    expect(refusal).toBeGreaterThan(-1)
    expect(composer.slice(refusal, refusal + 160)).toContain('setError(webRefusal)\n          return')
    expect(composer.indexOf('router.push(')).toBeGreaterThan(refusal)
  })

  it('setting web visibility goes through the RPC only and maps errors to calm copy', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'DISPATCH_WEB:account_unavailable' } }))
    expect(await setDispatchWebPublic({ rpc } as never, 'id', true)).toEqual({ ok: false, message: 'Your account can’t make Dispatches public right now.' })
    expect(rpc).toHaveBeenCalledWith('set_dispatch_web_public', { p_dispatch_id: 'id', p_public: true })
  })

  it('share links stay link-only: /d/[token] keeps noindex, nofollow', () => {
    expect(read('app/d/[shareToken]/page.tsx')).toContain('const robots = { index: false, follow: false, googleBot: { index: false, follow: false } }')
  })
})

describe('listing', () => {
  it('drops anything that is not a well-formed slug', async () => {
    const rpc = vi.fn(async () => ({ data: [{ web_slug: 'ok-abc123', last_modified: 't' }, { web_slug: '<x>', last_modified: 't' }], error: null }))
    expect(await listPublicDispatches({ rpc } as never)).toEqual([{ slug: 'ok-abc123', lastModified: 't' }])
  })
})

describe('atomic save + visibility (client side)', () => {
  const capture = () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return { data: { id: 'x', author_id: 'a', title: 't', body: 'b', published_at: 'p', moderation_status: 'visible' }, error: null }
    })
    return { client: { rpc } as never, calls }
  }
  const base = { title: 't', body: 'b', topics: [], safetyEvaluationId: 'e' }

  it('public → members-only on edit: one call to update_dispatch_with_web_visibility with p_web_public=false', async () => {
    const { updateDispatch } = await import('@/lib/dispatches')
    const { client, calls } = capture()
    await updateDispatch(client, 'd1', { ...base, webPublic: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].fn).toBe('update_dispatch_with_web_visibility')
    expect(calls[0].args).toMatchObject({ p_dispatch_id: 'd1', p_web_public: false })
  })

  it('members-only → public on edit and on publish: the same single call with p_web_public=true', async () => {
    const { updateDispatch, publishDispatch } = await import('@/lib/dispatches')
    const { client, calls } = capture()
    await updateDispatch(client, 'd1', { ...base, webPublic: true })
    await publishDispatch(client, { ...base, webPublic: true })
    expect(calls.map((c) => [c.fn, c.args.p_web_public])).toEqual([
      ['update_dispatch_with_web_visibility', true],
      ['publish_dispatch_with_web_visibility', true],
    ])
  })

  it('official / sponsored created with Public on the web unchecked: one atomic call with p_web_public=false', async () => {
    const { publishOfficialDispatch, updateOfficialDispatch } = await import('@/lib/dispatches')
    const { client, calls } = capture()
    await publishOfficialDispatch(client, { publishedAs: 'tempa', title: 't', body: 'b', topics: [], webPublic: false })
    await publishOfficialDispatch(client, { publishedAs: 'sponsored', title: 't', body: 'b', topics: [], webPublic: false,
      sponsor: { sponsorName: 'Paper Co', ctaLabel: '', ctaUrl: '' } })
    await updateOfficialDispatch(client, 'o1', { publishedAs: 'tempa', title: 't', body: 'b', topics: [], webPublic: false })
    expect(calls.map((c) => [c.fn, c.args.p_web_public])).toEqual([
      ['publish_official_dispatch_with_web_visibility', false],
      ['publish_official_dispatch_with_web_visibility', false],
      ['update_official_dispatch_with_web_visibility', false],
    ])
  })

  it('without the choice (before the migration) the original RPCs are used unchanged', async () => {
    const { publishDispatch, updateDispatch } = await import('@/lib/dispatches')
    const { client, calls } = capture()
    await publishDispatch(client, base)
    await updateDispatch(client, 'd1', base)
    expect(calls.map((c) => c.fn)).toEqual(['publish_dispatch', 'update_dispatch'])
    expect(calls.every((c) => !('p_web_public' in c.args))).toBe(true)
  })

  it('a visibility refusal fails the whole save and is surfaced with plain copy (nothing saved)', async () => {
    const { updateDispatch } = await import('@/lib/dispatches')
    const { webVisibilityRefusal } = await import('@/lib/public-dispatches')
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'DISPATCH_WEB:not_found', code: 'P0002' } }))
    const r = await updateDispatch({ rpc } as never, 'd1', { ...base, webPublic: false })
    expect(r.data).toBeNull()
    expect(webVisibilityRefusal(r.error?.message)).toBe(WEB_PUBLIC_COPY.saveRefused)
    expect(webVisibilityRefusal('DISPATCH_WEB:account_unavailable')).toBe(WEB_PUBLIC_COPY.accountRefused)
    expect(webVisibilityRefusal('This Dispatch can no longer be edited.')).toBeNull()
    expect(WEB_PUBLIC_COPY.saveRefused).toMatch(/^Nothing was saved/)
  })

  it('the standing control surfaces a failed change and never silently keeps going', () => {
    const control = read('app/board/[dispatchId]/web-visibility-control.tsx')
    expect(control).toMatch(/if \(!result\.ok\) \{\s*setError\(result\.message\)\s*return/)
    expect(control).toContain('role="alert"')
  })
})
