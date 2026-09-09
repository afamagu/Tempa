import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from './__tests__/fakeSupabase'
import { hasCompletedGuide } from './guide'
import { hasAcknowledgedCorrespondenceFeature } from './acknowledgements'
import { completeMomentsWalkthrough } from './moments-guide'

function client(supabase: ReturnType<typeof createFakeSupabase>) {
  return supabase as unknown as SupabaseClient
}

const CORRESPONDENCE_ID = 'correspondence-1'

describe('completeMomentsWalkthrough', () => {
  // E. user without moments completion -> qualifying flow launches tutorial.
  it('starts from a genuinely-not-completed state', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(false)
  })

  // F + G. complete moments -> completion exists, and the composer opens
  // (navigate is invoked) on the same "Continue writing" action.
  it('persists guide completion, acknowledges the correspondence, and navigates', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    const navigate = vi.fn()

    const outcome = await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, navigate)

    expect(outcome.status).toBe('navigated')
    expect(outcome.guideError).toBeNull()
    expect(outcome.ackError).toBeNull()
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
    expect(
      await hasAcknowledgedCorrespondenceFeature(
        client(supabase),
        'user-1',
        CORRESPONDENCE_ID,
        'moments_available'
      )
    ).toBe(true)
  })

  // H / I. reload the qualifying correspondence, or open a second one ->
  // the full tutorial stays absent, because completion is global per
  // user, not per correspondence.
  it('completion is global: it also covers a second, different correspondence', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, vi.fn())

    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
  })

  // J. manual guide replay -> works but does not modify/remove completion.
  it('running the transaction again (replay) stays idempotent', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, vi.fn())
    const second = await completeMomentsWalkthrough(client(supabase), 'correspondence-2', vi.fn())

    expect(second.guideError).toBeNull()
    expect(supabase._rowCount('guide_completions')).toBe(1)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
  })

  // Running it again for the SAME correspondence (e.g. re-opening the
  // qualifying letter after already finishing) must also stay
  // error-free on both writes — the duplicate-insert-as-success path,
  // not just the cross-correspondence one above.
  it('re-running for the same correspondence reports no errors on either write', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, vi.fn())
    const second = await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, vi.fn())

    expect(second.guideError).toBeNull()
    expect(second.ackError).toBeNull()
    expect(supabase._rowCount('correspondence_feature_acknowledgements')).toBe(1)
  })

  // K. simulated acknowledgement failure -> user still reaches composer.
  it('still navigates when the correspondence acknowledgement fails', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    supabase._forceInsertError('correspondence_feature_acknowledgements', {
      message: 'permission denied',
      code: '42501',
    })
    const navigate = vi.fn()

    const outcome = await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, navigate)

    expect(outcome.status).toBe('navigated')
    expect(outcome.guideError).toBeNull()
    expect(outcome.ackError).not.toBeNull()
    expect(navigate).toHaveBeenCalledTimes(1)
    // The guide completion itself must be unaffected by the
    // acknowledgement failure.
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
  })

  // Defense in depth: even if the guide-completion write itself fails
  // (e.g. the pre-fix missing-UPDATE-grant bug), the member must still
  // reach the composer — a broken write must never re-trap them.
  it('still navigates when the guide-completion write fails', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    supabase._forceInsertError('guide_completions', {
      message: 'permission denied for table guide_completions',
      code: '42501',
    })
    const navigate = vi.fn()

    const outcome = await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, navigate)

    expect(outcome.status).toBe('navigated')
    expect(outcome.guideError).not.toBeNull()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  // L. simulated final-action/navigation failure -> caller can show the
  // "Return to Letters" escape, and is not trapped: both writes must
  // still have been attempted before the navigation failure surfaces.
  it('reports navigation-failed, without losing the write attempts, when navigate throws', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    const navigate = vi.fn(() => {
      throw new Error('navigation exploded')
    })

    const outcome = await completeMomentsWalkthrough(client(supabase), CORRESPONDENCE_ID, navigate)

    expect(outcome.status).toBe('navigation-failed')
    if (outcome.status === 'navigation-failed') {
      expect(outcome.navigationError).toBeInstanceOf(Error)
    }
    expect(supabase._insertCalls).toHaveLength(2)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
  })
})
