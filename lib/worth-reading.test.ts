import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isDispatchWorthReading, setDispatchWorthReading } from './worth-reading'
import { blockUser } from './blocking'
import { createFakeDispatches, type FakeDispatchRow } from './__tests__/fakeDispatches'

const AUTHOR_A = 'user-a'
const VIEWER = 'user-viewer'

function dispatchRow(overrides: Partial<FakeDispatchRow> = {}): FakeDispatchRow {
  return {
    id: 'd-1',
    author_id: AUTHOR_A,
    title: 'A title',
    body: 'Hello, wider Tempa.',
    status: 'published',
    published_at: '2026-09-07T00:00:00Z',
    ...overrides,
  }
}

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

describe('setDispatchWorthReading — marking (true)', () => {
  it('succeeds for an unblocked pair on a published, visible Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).toBeNull()
    expect(fake._worthReading).toEqual([{ dispatch_id: 'd-1', user_id: VIEWER, created_at: expect.any(String) }])
  })

  it('is idempotent — marking twice leaves exactly one row', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    await setDispatchWorthReading(client(fake), 'd-1', true)
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).toBeNull()
    expect(fake._worthReading.length).toBe(1)
  })

  it('rejects marking your own Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: AUTHOR_A, rows: [dispatchRow()] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error?.message).toContain('cannot mark your own Dispatch')
    expect(fake._worthReading).toEqual([])
  })

  it('rejects an unpublished Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ status: 'unpublished' })] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).not.toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('rejects a moderator-hidden Dispatch', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow({ moderation_status: 'hidden' })] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).not.toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('rejects a full-blocked pair — neutral wording, never names blocking as the reason', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).not.toBeNull()
    expect(error?.message.toLowerCase()).not.toContain('block')
    expect(fake._worthReading).toEqual([])
  })

  it('a letters-only block does NOT prevent marking — Stop letters has zero effect here', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A, scope: 'letters' }],
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).toBeNull()
  })

  it('rejects a suspended/banned author\'s Dispatch even though the row is still moderation_status = visible', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      accountStatus: { [AUTHOR_A]: 'suspended' },
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).not.toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('rejects when the acting member is restricted/suspended/banned', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      accountStatus: { [VIEWER]: 'restricted' },
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error).not.toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('unauthenticated is rejected', async () => {
    const fake = createFakeDispatches({ viewerId: null, rows: [dispatchRow()] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', true)
    expect(error?.message).toContain('Authentication required')
  })
})

describe('setDispatchWorthReading — FINAL SECURITY/HARDENING PATCH: NULL rejection (correction A)', () => {
  it('rejects a NULL p_worth_reading rather than silently marking', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    // Bypasses the wrapper's own boolean-only TS type deliberately — the
    // real RPC boundary (Postgres/PostgREST) has no such compile-time
    // guarantee, so this exercises the server-side guard directly.
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', null as unknown as boolean)
    expect(error?.message).toBe('Worth Reading state is required.')
    expect(fake._worthReading).toEqual([])
  })

  it('rejects an undefined p_worth_reading the same way', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', undefined as unknown as boolean)
    expect(error?.message).toBe('Worth Reading state is required.')
  })

  it('NULL is rejected before any account-status/eligibility gate runs — even a restricted viewer gets the same NULL message', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      accountStatus: { [VIEWER]: 'restricted' },
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', null as unknown as boolean)
    expect(error?.message).toBe('Worth Reading state is required.')
  })
})

describe('block_user — FINAL SECURITY/HARDENING PATCH: Worth Reading cleanup on a FULL block', () => {
  it('a full block clears the blocker\'s own mark on the blocked member\'s Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Author A' }],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    await blockUser(client(fake), AUTHOR_A, 'full')
    expect(fake._worthReading).toEqual([])
  })

  it('a full block clears the OTHER direction too — the blocked member\'s mark on the blocker\'s own Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [dispatchRow({ id: 'd-viewer', author_id: VIEWER })],
      profiles: [{ id: VIEWER, pseudonym: 'Viewer' }],
      worthReading: [{ dispatch_id: 'd-viewer', user_id: AUTHOR_A }],
    })
    await blockUser(client(fake), VIEWER, 'full')
    expect(fake._worthReading).toEqual([])
  })

  it('a full block never clears an unrelated third member\'s mark', async () => {
    const OTHER = 'user-other'
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow(), dispatchRow({ id: 'd-2', author_id: AUTHOR_A })],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Author A' }],
      worthReading: [
        { dispatch_id: 'd-1', user_id: VIEWER },
        { dispatch_id: 'd-2', user_id: OTHER },
      ],
    })
    await blockUser(client(fake), AUTHOR_A, 'full')
    expect(fake._worthReading).toEqual([{ dispatch_id: 'd-2', user_id: OTHER }])
  })

  it('a letters-only block does NOT clear Worth Reading — Stop letters has zero effect here', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Author A' }],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    await blockUser(client(fake), AUTHOR_A, 'letters')
    expect(fake._worthReading).toEqual([{ dispatch_id: 'd-1', user_id: VIEWER }])
  })

  it('upgrading an existing letters-only block to full clears Worth Reading at the moment of upgrade', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      profiles: [{ id: AUTHOR_A, pseudonym: 'Author A' }],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    await blockUser(client(fake), AUTHOR_A, 'letters')
    expect(fake._worthReading).toEqual([{ dispatch_id: 'd-1', user_id: VIEWER }])
    await blockUser(client(fake), AUTHOR_A, 'full')
    expect(fake._worthReading).toEqual([])
  })
})

describe('setDispatchWorthReading — undoing (false)', () => {
  it('removes only the caller\'s own mark for that Dispatch', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', false)
    expect(error).toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('is idempotent — undoing an absent mark is a silent success, not an error', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', false)
    expect(error).toBeNull()
  })

  it('remains available for a full-blocked pair — de-escalating, same as unkeepMind', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
      blocked: [{ blocker_id: VIEWER, blocked_id: AUTHOR_A }],
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', false)
    expect(error).toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('remains available regardless of account status', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
      accountStatus: { [VIEWER]: 'banned' },
    })
    const { error } = await setDispatchWorthReading(client(fake), 'd-1', false)
    expect(error).toBeNull()
    expect(fake._worthReading).toEqual([])
  })

  it('never removes another member\'s mark on the same Dispatch', async () => {
    const OTHER_VIEWER = 'user-other-viewer'
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      worthReading: [
        { dispatch_id: 'd-1', user_id: VIEWER },
        { dispatch_id: 'd-1', user_id: OTHER_VIEWER },
      ],
    })
    await setDispatchWorthReading(client(fake), 'd-1', false)
    expect(fake._worthReading).toEqual([{ dispatch_id: 'd-1', user_id: OTHER_VIEWER }])
  })
})

describe('isDispatchWorthReading', () => {
  it('is true only for the querying viewer\'s own mark', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow()],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    expect(await isDispatchWorthReading(client(fake), VIEWER, 'd-1')).toBe(true)
  })

  it('is false when no mark exists', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [dispatchRow()] })
    expect(await isDispatchWorthReading(client(fake), VIEWER, 'd-1')).toBe(false)
  })

  it('private — the Dispatch author can never see another member\'s mark via this same query shape', async () => {
    const OTHER_VIEWER = 'user-other-viewer'
    const fake = createFakeDispatches({
      viewerId: AUTHOR_A,
      rows: [dispatchRow()],
      worthReading: [{ dispatch_id: 'd-1', user_id: OTHER_VIEWER }],
    })
    // RLS (dispatch_worth_reading_own) scopes every row to auth.uid() =
    // user_id — querying as the Dispatch's author, who marked nothing
    // themselves, must never see the OTHER member's mark, even though
    // this call literally asks about OTHER_VIEWER's id.
    expect(await isDispatchWorthReading(client(fake), OTHER_VIEWER, 'd-1')).toBe(false)
  })

  it('is scoped per-Dispatch — a mark on one Dispatch does not read as true for another', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [dispatchRow(), dispatchRow({ id: 'd-2' })],
      worthReading: [{ dispatch_id: 'd-1', user_id: VIEWER }],
    })
    expect(await isDispatchWorthReading(client(fake), VIEWER, 'd-2')).toBe(false)
  })
})
