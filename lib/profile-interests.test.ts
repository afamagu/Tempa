import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProfileInterestKeys, setProfileInterests } from './profile-interests'
import { createFakeDispatches } from './__tests__/fakeDispatches'

const VIEWER = 'user-viewer'

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

// Board Personalization Phase 2B, product-review correction — proves the
// EXISTING-MEMBER side of the "NEW PROFILE: 3-8, EXISTING USER: 0-8"
// split at the layer that actually matters: the data path app/you/
// interests's editor calls. That page's own save handler (interests-
// editor.tsx) never imports or calls isReadingInterestsCountValidFor
// NewProfile (see lib/interests.test.ts for that gate's own tests) — it
// is free to save zero selections at any time, and this is what proves
// that save genuinely succeeds and genuinely persists as zero, not
// merely that the UI doesn't show an error.
describe('setProfileInterests / getProfileInterestKeys — existing-member 0-8 behavior (never gated at 3)', () => {
  it('a brand-new viewer with zero rows reads back an empty array — the zero-interest state, never an error', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const keys = await getProfileInterestKeys(client(fake), VIEWER)
    expect(keys).toEqual([])
  })

  it('saving an EMPTY selection succeeds — an existing member removing all their interests is a fully valid save, never blocked', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profileInterests: [{ viewer_user_id: VIEWER, interest_key: 'spirituality-faith' }],
    })
    const { error } = await setProfileInterests(client(fake), [])
    expect(error).toBeNull()
    expect(await getProfileInterestKeys(client(fake), VIEWER)).toEqual([])
  })

  it('saving exactly 1 or 2 selections also succeeds for an existing member — the 3-minimum is a NEW-PROFILE-ONLY rule', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const { error } = await setProfileInterests(client(fake), ['music'])
    expect(error).toBeNull()
    expect(await getProfileInterestKeys(client(fake), VIEWER)).toEqual(['music'])
  })

  it('saving replaces the full prior selection atomically — an old selection never lingers alongside a new, smaller one', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profileInterests: [
        { viewer_user_id: VIEWER, interest_key: 'music' },
        { viewer_user_id: VIEWER, interest_key: 'travel-places' },
        { viewer_user_id: VIEWER, interest_key: 'history' },
      ],
    })
    await setProfileInterests(client(fake), ['food-cooking'])
    expect(await getProfileInterestKeys(client(fake), VIEWER)).toEqual(['food-cooking'])
  })

  it('silently drops an unknown/invalid key client-side (defense in depth) rather than sending it to the RPC', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const { error } = await setProfileInterests(client(fake), ['music', 'not-a-real-interest'])
    expect(error).toBeNull()
    expect(await getProfileInterestKeys(client(fake), VIEWER)).toEqual(['music'])
  })

  it('caps at MAX_INTERESTS (8) client-side even if a caller passes more', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const tooMany = [
      'life-reflections', 'family-parenting', 'friendship', 'love-relationships',
      'spirituality-faith', 'philosophy', 'psychology', 'books-literature', 'writing-poetry',
    ]
    const { error } = await setProfileInterests(client(fake), tooMany)
    expect(error).toBeNull()
    const saved = await getProfileInterestKeys(client(fake), VIEWER)
    expect(saved.length).toBeLessThanOrEqual(8)
  })

  it('one viewer\'s selection never leaks into another viewer\'s read (self-scoped, mirroring profile_interests_select_own RLS)', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profileInterests: [{ viewer_user_id: 'someone-else', interest_key: 'music' }],
    })
    expect(await getProfileInterestKeys(client(fake), VIEWER)).toEqual([])
  })
})
