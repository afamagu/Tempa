import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createFakeSupabase } from './__tests__/fakeSupabase'
import { hasCompletedGuide, markGuideCompleted } from './guide'

function client(supabase: ReturnType<typeof createFakeSupabase>) {
  return supabase as unknown as SupabaseClient
}

describe('hasCompletedGuide', () => {
  // A. user without minds completion -> tutorial eligible
  it('reports not-completed for a user with no completion row', async () => {
    const supabase = createFakeSupabase()
    const completed = await hasCompletedGuide(client(supabase), 'user-1', 'minds')
    expect(completed).toBe(false)
  })

  it('does not confuse one user or one guide key with another', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await markGuideCompleted(client(supabase), 'minds')

    expect(await hasCompletedGuide(client(supabase), 'user-1', 'minds')).toBe(true)
    // Different guide key, same user -> still not completed.
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(false)
    // Same guide key, different user -> still not completed.
    expect(await hasCompletedGuide(client(supabase), 'user-2', 'minds')).toBe(false)
  })

  // Onboarding & First-Use checkpoint — the four new FeatureIntroduction
  // keys (people/board/dispatch_composer/postcard) are plain additions
  // to the free-text GuideKey union, reusing the exact same
  // guide_completions table/RPC-free INSERT path as 'moments'/'minds' —
  // no new SQL, no new persistence system. These prove that.
  it('the new FeatureIntroduction guide keys round-trip through the same guide_completions mechanism as the existing walkthroughs', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    for (const key of ['people', 'board', 'dispatch_composer', 'postcard'] as const) {
      expect(await hasCompletedGuide(client(supabase), 'user-1', key)).toBe(false)
      const { error } = await markGuideCompleted(client(supabase), key)
      expect(error).toBeNull()
      expect(await hasCompletedGuide(client(supabase), 'user-1', key)).toBe(true)
    }
  })

  it('the four new keys remain fully independent of each other and of the existing walkthroughs', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await markGuideCompleted(client(supabase), 'people')
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'people')).toBe(true)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'board')).toBe(false)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'dispatch_composer')).toBe(false)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'postcard')).toBe(false)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'minds')).toBe(false)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(false)
  })
})

describe('markGuideCompleted', () => {
  // B. complete minds -> completion exists
  it('persists a completion row that a subsequent read finds', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })

    const { error } = await markGuideCompleted(client(supabase), 'minds')

    expect(error).toBeNull()
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'minds')).toBe(true)
    expect(supabase._insertCalls).toEqual([
      {
        table: 'guide_completions',
        payload: { user_id: 'user-1', guide_key: 'minds' },
      },
    ])
  })

  // C / D. reload Minds, or navigate away and back -> tutorial stays absent.
  // Each "page load" in production is a fresh hasCompletedGuide() call
  // against the same row; nothing here should make it revert to false.
  it('stays completed across repeated reads, simulating reload / route changes', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await markGuideCompleted(client(supabase), 'minds')

    for (let i = 0; i < 3; i++) {
      expect(await hasCompletedGuide(client(supabase), 'user-1', 'minds')).toBe(true)
    }
  })

  // J. manual guide replay -> works but does not modify/remove completion.
  it('replaying (calling it again once already complete) stays idempotent', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })

    const first = await markGuideCompleted(client(supabase), 'moments')
    const second = await markGuideCompleted(client(supabase), 'moments')

    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(supabase._rowCount('guide_completions')).toBe(1)
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'moments')).toBe(true)
  })

  it('does not write, and reports an error, when there is no authenticated user', async () => {
    const supabase = createFakeSupabase({ user: null })

    const { error } = await markGuideCompleted(client(supabase), 'minds')

    expect(error).not.toBeNull()
    expect(supabase._insertCalls).toHaveLength(0)
  })

  // Regression test for the original root cause: guide_completions was
  // only ever granted `select, insert`, never `update`, so the previous
  // upsert-based implementation (`INSERT ... ON CONFLICT DO UPDATE`)
  // failed permission-denied on every call, even a brand-new user's
  // very first completion — see
  // docs/sql/2026-09-01-guide-completions-update-grant.sql for the full
  // history. markGuideCompleted now uses a plain INSERT specifically to
  // avoid ever needing UPDATE privilege at all; this test pins that a
  // genuine, non-duplicate write failure (e.g. a real permission error)
  // still surfaces instead of being swallowed.
  it('surfaces a genuine write failure instead of swallowing it', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    supabase._forceInsertError('guide_completions', {
      message: 'permission denied for table guide_completions',
      code: '42501',
    })

    const { error } = await markGuideCompleted(client(supabase), 'minds')

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
    // And, crucially, the failed write really did not persist —
    // hasCompletedGuide must keep reporting "not completed" (the
    // observed bug), not silently claim success.
    expect(await hasCompletedGuide(client(supabase), 'user-1', 'minds')).toBe(false)
  })

  // The design this file's markGuideCompleted now relies on: a
  // duplicate insert (23505, unique_violation on the primary key) is
  // treated as success, not surfaced as an error — this is what makes
  // a plain INSERT safely idempotent without ever needing UPDATE.
  it('treats a duplicate-key insert as success, not an error', async () => {
    const supabase = createFakeSupabase({ user: { id: 'user-1' } })
    await markGuideCompleted(client(supabase), 'minds')

    const { error } = await markGuideCompleted(client(supabase), 'minds')

    expect(error).toBeNull()
    expect(supabase._rowCount('guide_completions')).toBe(1)
  })
})
