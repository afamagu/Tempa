import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from './__tests__/fakeSupabase'
import { hasAcknowledgedCorrespondenceFeature, acknowledgeCorrespondenceFeature } from './acknowledgements'

function client(supabase: ReturnType<typeof createFakeSupabase>) {
  return supabase as unknown as SupabaseClient
}

describe('hasAcknowledgedCorrespondenceFeature', () => {
  it('reports not-acknowledged when no row exists', async () => {
    const supabase = createFakeSupabase()
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
      false
    )
  })

  it('does not confuse one user, correspondence, or feature key with another', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
      true
    )
    // Different feature key, same user/correspondence -> still not acknowledged.
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'moments_available')).toBe(
      false
    )
    // Different correspondence, same user/feature -> still not acknowledged
    // (a closed episode and a later new episode are independent rows).
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-2', 'first_photo_notice')).toBe(
      false
    )
    // Different user, same correspondence/feature -> still not acknowledged
    // (each participant's acknowledgement is independent of the other's).
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-2', 'corr-1', 'first_photo_notice')).toBe(
      false
    )
  })
})

describe('acknowledgeCorrespondenceFeature', () => {
  it('persists an acknowledgement that a subsequent read finds', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })

    const { error } = await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    expect(error).toBeNull()
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
      true
    )
    expect(supabase._insertCalls).toEqual([
      {
        table: 'correspondence_feature_acknowledgements',
        payload: { user_id: 'user-1', correspondence_id: 'corr-1', feature_key: 'first_photo_notice' },
      },
    ])
  })

  // Root cause of the repeated first-photo-explanation bug: this must
  // survive closing/reopening the composer, a refresh, or signing out
  // and back in — i.e. every later read, independent of session state.
  it('stays acknowledged across repeated reads, simulating reload / composer close-reopen / a new sign-in', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    for (let i = 0; i < 3; i++) {
      expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
        true
      )
    }
  })

  it('is idempotent — a duplicate acknowledgement (23505 unique_violation) is treated as success, never surfaced as an error', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    const { error } = await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    expect(error).toBeNull()
    expect(supabase._rowCount('correspondence_feature_acknowledgements')).toBe(1)
  })

  it('returns an error (never thrown, never swallowed) for a genuine write failure', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    supabase._forceInsertError('correspondence_feature_acknowledgements', { message: 'permission denied', code: '42501' })

    const { error } = await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    expect(error).toEqual({ message: 'permission denied', code: '42501' })
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
      false
    )
  })

  it('rejects with a descriptive error when called with no authenticated user, rather than writing an ownerless row', async () => {
    const supabase = createFakeSupabase({ user: null })

    const { error } = await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'first_photo_notice')

    expect(error?.message).toMatch(/no authenticated user/i)
    expect(supabase._insertCalls).toEqual([])
  })

  it('the two feature keys (moments_available, first_photo_notice) round-trip independently of each other for the same user/correspondence', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await acknowledgeCorrespondenceFeature(client(supabase), 'corr-1', 'moments_available')

    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'moments_available')).toBe(
      true
    )
    expect(await hasAcknowledgedCorrespondenceFeature(client(supabase), 'user-1', 'corr-1', 'first_photo_notice')).toBe(
      false
    )
  })
})
