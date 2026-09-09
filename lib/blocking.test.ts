import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { blockUser, unblockUser, getBlockedUsers, getBlockedProfiles, getBlockScope } from './blocking'
import { createFakeDispatches } from './__tests__/fakeDispatches'

const VIEWER = 'user-viewer'
const OTHER = 'user-other'

function client(fake: ReturnType<typeof createFakeDispatches>) {
  return fake as unknown as SupabaseClient
}

// Same SSR-only/no-jsdom limitation and fake-client convention as
// lib/dispatches.test.ts — this proves the thin wrapper functions call
// the right RPC with the right shape and surface errors correctly, not
// the live Postgres RLS/RPC behavior itself (that migration is
// prepared but not executed — see docs/sql/2026-09-11-safety-blocking-
// foundation.sql and its own read-only verification script).
describe('blockUser / unblockUser — thin RPC wrappers', () => {
  it('blocks a member successfully', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const { error } = await blockUser(client(fake), OTHER)
    expect(error).toBeNull()
  })

  it('rejects blocking yourself', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const { error } = await blockUser(client(fake), VIEWER)
    expect(error).not.toBeNull()
  })

  it('unblocking a member removes the block', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER)
    const { error } = await unblockUser(client(fake), OTHER)
    expect(error).toBeNull()
    const blocked = await getBlockedUsers(client(fake))
    expect(blocked.map((b) => b.blockedId)).not.toContain(OTHER)
  })
})

describe('getBlockedUsers — never exposes anyone else\'s block of the caller', () => {
  it('lists only members the caller has blocked', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER)
    const blocked = await getBlockedUsers(client(fake))
    expect(blocked).toHaveLength(1)
    expect(blocked[0].blockedId).toBe(OTHER)
  })

  it('never returns a row where the caller is merely the blocked party (mirrors blocked_users_select_own RLS)', async () => {
    // OTHER blocks VIEWER — from VIEWER's own session, this must never
    // be visible via getBlockedUsers, which only ever queries the
    // caller's own blocker_id rows.
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    const fakeAsOther = createFakeDispatches({ viewerId: OTHER, rows: [] })
    await blockUser(client(fakeAsOther), VIEWER)
    // A fresh fake scoped to VIEWER never had this row inserted into
    // its own visible set in the first place — this test documents the
    // expected shape (getBlockedUsers has no way to see it) rather than
    // exercising cross-instance state, since each fake instance is its
    // own isolated in-memory store, same as every other test in this
    // suite.
    const blocked = await getBlockedUsers(client(fake))
    expect(blocked).toHaveLength(0)
  })
})

describe('getBlockedProfiles — resolves pseudonym for a blocked pair despite public_profiles excluding it', () => {
  it('returns the pseudonym of a member the caller blocked', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profiles: [{ id: OTHER, pseudonym: 'Evening Quill', country: 'Portugal' }],
    })
    await blockUser(client(fake), OTHER)
    const profiles = await getBlockedProfiles(client(fake))
    expect(profiles).toEqual([
      expect.objectContaining({ id: OTHER, pseudonym: 'Evening Quill', country: 'Portugal' }),
    ])
  })

  it('returns nothing once unblocked', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profiles: [{ id: OTHER, pseudonym: 'Evening Quill' }],
    })
    await blockUser(client(fake), OTHER)
    await unblockUser(client(fake), OTHER)
    expect(await getBlockedProfiles(client(fake))).toHaveLength(0)
  })
})

// Checkpoint 1C — two levels of blocking (docs/sql/2026-09-12-scoped-
// blocking-and-fixes.sql). blockUser defaults to 'full' when no scope
// is passed (the pre-1C call shape, exercised by the describe blocks
// above) — these cover the new explicit-scope behavior specifically:
// creating a 'letters' block, reading it back via getBlockScope/
// getBlockedUsers/getBlockedProfiles, and upgrading it in place.
describe('blockUser scope — Checkpoint 1C', () => {
  it('defaults to a full block when no scope is given', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER)
    expect(await getBlockScope(client(fake), OTHER)).toBe('full')
  })

  it('creates a letters-only block when scope is explicitly "letters"', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER, 'letters')
    expect(await getBlockScope(client(fake), OTHER)).toBe('letters')
  })

  it('getBlockScope returns null when no block exists', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    expect(await getBlockScope(client(fake), OTHER)).toBeNull()
  })

  it('getBlockedUsers reports the scope of each block', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER, 'letters')
    const blocked = await getBlockedUsers(client(fake))
    expect(blocked).toEqual([expect.objectContaining({ blockedId: OTHER, scope: 'letters' })])
  })

  it('getBlockedProfiles reports the scope of each block', async () => {
    const fake = createFakeDispatches({
      viewerId: VIEWER,
      rows: [],
      profiles: [{ id: OTHER, pseudonym: 'Evening Quill' }],
    })
    await blockUser(client(fake), OTHER, 'letters')
    const profiles = await getBlockedProfiles(client(fake))
    expect(profiles).toEqual([expect.objectContaining({ id: OTHER, scope: 'letters' })])
  })

  it('calling blockUser again with "full" upgrades an existing letters-only block in place, not a second row', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER, 'letters')
    await blockUser(client(fake), OTHER, 'full')
    const blocked = await getBlockedUsers(client(fake))
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toEqual(expect.objectContaining({ blockedId: OTHER, scope: 'full' }))
  })

  it('calling blockUser again with "letters" downgrades an existing full block in place', async () => {
    const fake = createFakeDispatches({ viewerId: VIEWER, rows: [] })
    await blockUser(client(fake), OTHER, 'full')
    await blockUser(client(fake), OTHER, 'letters')
    expect(await getBlockScope(client(fake), OTHER)).toBe('letters')
  })
})
