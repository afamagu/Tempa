import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getDispatchById,
  getPinnedDispatch,
  getPublishedDispatches,
  getPublishedDispatchesByAuthor,
  partitionHomeSections,
  publishDispatch,
  publishOfficialDispatch,
  updateOfficialDispatch,
  type BoardFeedItem,
} from './dispatches'
import { resolveDispatchIdentity } from './dispatch-identity'
import { createFakeDispatches, type FakeDispatchRow } from './__tests__/fakeDispatches'

const ADMIN = 'admin-1'
const MEMBER = 'member-1'
const VIEWER = 'viewer-1'

const row = (o: Partial<FakeDispatchRow>): FakeDispatchRow => ({
  id: 'd',
  author_id: MEMBER,
  title: 'T',
  body: 'B',
  status: 'published',
  published_at: '2026-09-25T10:00:00Z',
  ...o,
})

const ROWS = () => [
  row({ id: 'member-d', author_id: MEMBER, title: 'Member writing', published_at: '2026-09-25T10:00:00Z' }),
  row({ id: 'admin-own-d', author_id: ADMIN, title: 'Admin as a member', published_at: '2026-09-25T09:00:00Z' }),
  row({ id: 'tempa-d', author_id: ADMIN, title: 'Welcome to Tempa', published_as: 'tempa', published_at: '2026-09-25T11:00:00Z' }),
  row({
    id: 'sponsored-d',
    author_id: ADMIN,
    title: 'Paper that lasts',
    published_as: 'sponsored',
    sponsor_name: 'Acme Paper',
    sponsor_cta_label: 'Shop',
    sponsor_cta_url: 'https://acme.example',
    published_at: '2026-09-25T12:00:00Z',
  }),
]
const PROFILES = [
  { id: MEMBER, pseudonym: 'Quiet Harbour', country: 'Kenya' },
  { id: ADMIN, pseudonym: 'Afam Personal', country: 'Nigeria', pinned_dispatch_id: 'tempa-d' },
  { id: VIEWER, pseudonym: 'Reader', country: null },
]
const client = (viewerId = VIEWER) =>
  createFakeDispatches({ viewerId, rows: ROWS(), profiles: PROFILES }) as unknown as SupabaseClient

describe('identity hydration — every listing goes through one resolver', () => {
  it('member Dispatches are unchanged: pseudonym, country, profile identity', async () => {
    const items = await getPublishedDispatches(client())
    const m = items.find((d) => d.id === 'member-d')!
    expect(m.publishedAs).toBe('member')
    expect(m.identity).toMatchObject({ kind: 'member', authorId: MEMBER, name: 'Quiet Harbour', country: 'Kenya' })
    expect(m.authorPseudonym).toBe('Quiet Harbour')
    // The admin's own member Dispatch is still an ordinary member Dispatch.
    expect(items.find((d) => d.id === 'admin-own-d')!.identity).toMatchObject({ kind: 'member', name: 'Afam Personal' })
  })

  it('Tempa Dispatch: "Tempa", no country/Mark, never the admin pseudonym or "A member"', async () => {
    const t = (await getPublishedDispatches(client())).find((d) => d.id === 'tempa-d')!
    expect(t.identity).toEqual({ kind: 'tempa', name: 'Tempa' })
    expect(t.authorPseudonym).toBe('Tempa')
    expect(t.authorCountry).toBeNull()
    expect(t.authorMarkUrl).toBeNull()
    expect(JSON.stringify(t.identity)).not.toMatch(/Afam|Nigeria|A member/)
  })

  it('Sponsored Dispatch: sponsor identity + safe CTA, never the admin', async () => {
    const s = (await getPublishedDispatches(client())).find((d) => d.id === 'sponsored-d')!
    expect(s.identity).toEqual({ kind: 'sponsored', name: 'Acme Paper', sponsor: { name: 'Acme Paper', ctaLabel: 'Shop', ctaUrl: 'https://acme.example/' } })
    expect(s.authorCountry).toBeNull()
    expect(JSON.stringify(s)).not.toMatch(/Afam Personal|Nigeria/)
  })

  it('the direct reader (getDispatchById) resolves the same identity', async () => {
    expect((await getDispatchById(client(), 'tempa-d'))!.identity.kind).toBe('tempa')
    expect((await getDispatchById(client(), 'sponsored-d'))!.identity.kind).toBe('sponsored')
  })
})

describe('profile exclusion', () => {
  it("the admin's profile lists only their own member Dispatches — never Tempa/Sponsored", async () => {
    const ids = (await getPublishedDispatchesByAuthor(client(), ADMIN)).map((d) => d.id)
    expect(ids).toEqual(['admin-own-d'])
  })

  it('a member profile is unchanged', async () => {
    expect((await getPublishedDispatchesByAuthor(client(), MEMBER)).map((d) => d.id)).toEqual(['member-d'])
  })

  it('a Tempa Dispatch can never surface as a pinned profile Dispatch', async () => {
    expect(await getPinnedDispatch(client(), ADMIN)).toBeNull()
  })
})

describe('Home exclusion', () => {
  const feed = (id: string, publishedAs: 'member' | 'tempa' | 'sponsored', isKept = false): BoardFeedItem => ({
    id,
    authorId: ADMIN,
    authorPseudonym: 'x',
    authorCountry: null,
    title: id,
    body: 'b',
    publishedAt: '2026-09-25T00:00:00Z',
    moderationStatus: 'visible',
    topics: [],
    publishedAs,
    identity: resolveDispatchIdentity({ publishedAs, authorId: ADMIN, authorPseudonym: 'x', authorCountry: null, sponsorName: 'Acme' }),
    isKept,
    isFamiliar: isKept,
    cursor: { seenBucket: 0, rankKey: '1', seedHash: 1, id },
  })

  it('Sponsored never appears in any Home section or the remainder strip', () => {
    const items = [feed('s1', 'sponsored'), feed('m1', 'member'), feed('s2', 'sponsored', true), feed('t1', 'tempa'), feed('m2', 'member')]
    const { featured, fromMindsYouKeep, serendipity, remainder } = partitionHomeSections(items)
    const all = [...featured, ...fromMindsYouKeep, ...serendipity, ...remainder].map((i) => i.id)
    expect(all).not.toContain('s1')
    expect(all).not.toContain('s2')
    expect(all).toContain('t1')
  })

  it('From Minds You Keep never includes a Tempa Dispatch (Tempa is not a kept Mind)', () => {
    const items = [feed('m0', 'member'), feed('m00', 'member'), feed('m000', 'member'), feed('t-kept', 'tempa', true), feed('m-kept', 'member', true)]
    const { fromMindsYouKeep } = partitionHomeSections(items)
    expect(fromMindsYouKeep.map((i) => i.id)).toEqual(['m-kept'])
  })
})

describe('publish paths', () => {
  function rpcSpy() {
    const calls: { fn: string; args: Record<string, unknown> }[] = []
    const supabase = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ fn, args })
        return { data: { id: 'new', author_id: ADMIN, title: 't', body: 'b', published_at: 'now', moderation_status: 'visible', published_as: args.p_published_as ?? 'member' }, error: null }
      },
    } as unknown as SupabaseClient
    return { supabase, calls }
  }

  it('member publishDispatch still calls publish_dispatch with a Safety evaluation and no identity argument', async () => {
    const { supabase, calls } = rpcSpy()
    await publishDispatch(supabase, { title: 't', body: 'b', topics: [], safetyEvaluationId: 'eval-1' })
    expect(calls[0].fn).toBe('publish_dispatch')
    expect(calls[0].args.p_safety_evaluation_id).toBe('eval-1')
    expect(Object.keys(calls[0].args)).not.toContain('p_published_as')
  })

  it('Tempa publish goes to the staff-only RPC and never sends sponsor fields', async () => {
    const { supabase, calls } = rpcSpy()
    await publishOfficialDispatch(supabase, {
      publishedAs: 'tempa',
      title: 't',
      body: 'b',
      topics: [],
      sponsor: { sponsorName: 'Sneaky', ctaLabel: 'x', ctaUrl: 'https://x.example' },
    })
    expect(calls[0].fn).toBe('publish_official_dispatch')
    expect(calls[0].args).toMatchObject({ p_published_as: 'tempa', p_sponsor_name: null, p_sponsor_cta_label: null, p_sponsor_cta_url: null })
    expect(Object.keys(calls[0].args)).not.toContain('p_safety_evaluation_id')
  })

  it('Sponsored publish sends trimmed sponsor fields; edit uses update_official_dispatch', async () => {
    const { supabase, calls } = rpcSpy()
    await publishOfficialDispatch(supabase, {
      publishedAs: 'sponsored',
      title: 't',
      body: 'b',
      topics: [],
      sponsor: { sponsorName: '  Acme  ', ctaLabel: '', ctaUrl: ' https://acme.example ' },
    })
    await updateOfficialDispatch(supabase, 'd-1', { publishedAs: 'sponsored', title: 't', body: 'b', topics: [], sponsor: { sponsorName: 'Acme', ctaLabel: '', ctaUrl: '' } })
    expect(calls[0].args).toMatchObject({ p_sponsor_name: 'Acme', p_sponsor_cta_label: null, p_sponsor_cta_url: 'https://acme.example' })
    expect(calls[1].fn).toBe('update_official_dispatch')
    expect(calls[1].args).toMatchObject({ p_dispatch_id: 'd-1', p_sponsor_name: 'Acme', p_sponsor_cta_url: null })
  })
})
