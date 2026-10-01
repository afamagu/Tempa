import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getDiscoveryPage, genderDisplay, DISCOVERY_BATCH_SIZE, MAX_DISCOVERY_LIMIT } from './discovery'

function entry(n: number) {
  return {
    user_id: `u${n}`,
    pseudonym: `P${n}`,
    country: 'NG',
    gender: 'Woman',
    gender_custom: null,
    age_range: '25-34',
    mark_id: n % 2 ? `m${n}` : null,
    answer_id: `a${n}`,
    body: `body ${n}`,
    prompt: `prompt ${n}`,
  }
}

function fakeClient(result: { data: unknown; error: unknown }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return result
    },
    from: () => {
      throw new Error('discovery must not read tables directly')
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('getDiscoveryPage — one bounded RPC', () => {
  it('makes exactly one discover_people_v2 call and never touches a table', async () => {
    const { client, calls } = fakeClient({ data: { eligible_count: 3, filtered_count: 3, entries: [entry(1)] }, error: null })
    await getDiscoveryPage(client)
    expect(calls).toHaveLength(1)
    expect(calls[0].fn).toBe('discover_people_v2')
  })

  it('defaults to the six-per-batch window and passes filters/offset through', async () => {
    const { client, calls } = fakeClient({ data: { entries: [] }, error: null })
    await getDiscoveryPage(client, { country: 'KE', gender: 'Man', ageRange: '35-44', offset: 12 })
    expect(calls[0].args).toEqual({ p_country: 'KE', p_gender: 'Man', p_age_range: '35-44', p_offset: 12, p_limit: DISCOVERY_BATCH_SIZE, p_question_id: null, p_exclude_user_ids: [], p_browse_started_at: null })
  })

  it('treats empty filter strings as "no filter"', async () => {
    const { client, calls } = fakeClient({ data: { entries: [] }, error: null })
    await getDiscoveryPage(client, { country: '', gender: '', ageRange: '' })
    expect(calls[0].args).toMatchObject({ p_country: null, p_gender: null, p_age_range: null })
  })

  it('clamps limit and offset to safe bounds', async () => {
    const { client, calls } = fakeClient({ data: { entries: [] }, error: null })
    await getDiscoveryPage(client, { limit: 10_000, offset: -5 })
    await getDiscoveryPage(client, { limit: 0, offset: 1e15 })
    expect(calls[0].args).toMatchObject({ p_limit: MAX_DISCOVERY_LIMIT, p_offset: 0 })
    expect(calls[1].args).toMatchObject({ p_limit: 1, p_offset: 2147483647 })
  })

  it('returns at most the requested batch size, even if the RPC over-returns', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(i))
    const { client } = fakeClient({ data: { eligible_count: 30, filtered_count: 30, entries }, error: null })
    const page = await getDiscoveryPage(client, { limit: 6 })
    expect(page.candidates).toHaveLength(6)
    expect(page.filteredCount).toBe(30)
  })

  it('never shows the same person twice on one page', async () => {
    const { client } = fakeClient({ data: { entries: [entry(1), entry(1), entry(2)] }, error: null })
    const page = await getDiscoveryPage(client)
    expect(page.candidates.map((c) => c.userId)).toEqual(['u1', 'u2'])
  })

  it('maps the response-first card data', async () => {
    const { client } = fakeClient({ data: { eligible_count: 1, filtered_count: 1, entries: [{ ...entry(1), prompt: null }] }, error: null })
    const [c] = (await getDiscoveryPage(client)).candidates
    expect(c).toEqual({
      userId: 'u1', pseudonym: 'P1', country: 'NG', gender: 'Woman', genderCustom: null, ageRange: '25-34',
      markId: 'm1', answerId: 'a1', body: 'body 1', prompt: '',
    })
  })

  it('degrades to an empty page (calm empty state) on RPC error', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    expect(await getDiscoveryPage(client)).toEqual({ candidates: [], eligibleCount: 0, filteredCount: 0, fairRankingApplied: false, browseStartedAt: null })
  })
})

describe('genderDisplay', () => {
  it('hides unspecified gender and shows self-described text', () => {
    expect(genderDisplay(null, null)).toBeNull()
    expect(genderDisplay('Prefer not to say', null)).toBeNull()
    expect(genderDisplay('Self-describe', 'Agender')).toBe('Agender')
    expect(genderDisplay('Self-describe', '')).toBeNull()
    expect(genderDisplay('Woman', null)).toBe('Woman')
  })
})


describe('discovery rollout and browse continuity', () => {
  it('uses legacy paging for ordinary discovery if V2 is unavailable', async () => {
    const calls: string[] = []
    const client = { rpc: async (fn: string) => {
      calls.push(fn)
      return fn === 'discover_people_v2' ? { data: null, error: { code: '42883' } } : { data: { entries: [entry(1)] }, error: null }
    } } as unknown as SupabaseClient
    const page = await getDiscoveryPage(client)
    expect(calls).toEqual(['discover_people_v2', 'discover_people'])
    expect(page.candidates).toHaveLength(1)
    expect(page.fairRankingApplied).toBe(false)
  })

  it('never labels generic discovery as answers to a specific Question', async () => {
    const { client, calls } = fakeClient({ data: null, error: { code: '42883' } })
    const page = await getDiscoveryPage(client, { questionId: 'live-question' })
    expect(page.candidates).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('carries the database browse timestamp into the next request', async () => {
    const started = '2026-10-01T11:00:00+00:00'
    const { client, calls } = fakeClient({ data: { entries: [], browse_started_at: started }, error: null })
    const first = await getDiscoveryPage(client)
    await getDiscoveryPage(client, { browseStartedAt: first.browseStartedAt!, offset: 6 })
    expect(first.browseStartedAt).toBe(started)
    expect(calls[1].args.p_browse_started_at).toBe(started)
  })

  it('normalizes invalid numeric limits and offsets', async () => {
    const { client, calls } = fakeClient({ data: { entries: [] }, error: null })
    await getDiscoveryPage(client, { limit: NaN, offset: Infinity })
    expect(calls[0].args).toMatchObject({ p_limit: 6, p_offset: 0 })
  })
})
