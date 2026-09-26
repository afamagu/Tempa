import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLOSED_ACCOUNT_BAN_DURATION,
  disableClosedAuthUser,
  eligibleStorageObjects,
  finalizeAccountClosure,
  removeClosedAccountStorage,
  tombstoneEmail,
} from './account-deletion'

const UID = '00000000-0000-4000-8000-000000000001'
const MARK = '11111111-2222-4333-8444-555555555555.png'

type Calls = { removes: { bucket: string; paths: string[] }[]; authUpdates: Record<string, unknown>[]; closureUpdates: Record<string, unknown>[] }

function fakeService(opts: { enforcement?: string | null; reports?: number; cases?: number; failRemove?: boolean; failEmailUpdate?: boolean; failBan?: boolean } = {}) {
  const calls: Calls = { removes: [], authUpdates: [], closureUpdates: [] }
  const table = (name: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: opts.enforcement ? { status: opts.enforcement } : null, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ count: name === 'reports' ? (opts.reports ?? 0) : (opts.cases ?? 0), error: null }),
      update: (values: Record<string, unknown>) => {
        calls.closureUpdates.push(values)
        return { eq: async () => ({ error: null }) }
      },
    }
    return chain
  }
  const service = {
    from: table,
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.removes.push({ bucket, paths })
          return { error: opts.failRemove ? { message: 'boom' } : null }
        },
      }),
    },
    auth: {
      admin: {
        updateUserById: async (_id: string, attrs: Record<string, unknown>) => {
          calls.authUpdates.push(attrs)
          if ('email' in attrs && opts.failEmailUpdate) return { error: { message: 'email rejected' } }
          if (opts.failBan) return { error: { message: 'auth down' } }
          return { error: null }
        },
      },
    },
  } as unknown as SupabaseClient
  return { service, calls }
}

describe('eligibleStorageObjects — only this member’s own objects in member buckets', () => {
  it('keeps Mark files and this member’s Dispatch photos only', () => {
    const out = eligibleStorageObjects(UID, {
      'profile-marks': [MARK, '../escape.png', 'not-a-uuid.png'],
      'dispatch-photos': [`${UID}/a.jpg`, `${UID}/../other/b.jpg`, `other-user/c.jpg`, `${UID}/nested/d.jpg`],
    })
    expect(out).toEqual({ 'profile-marks': [MARK], 'dispatch-photos': [`${UID}/a.jpg`] })
  })

  it('never lists letter photos, postcard artwork or announcement images (unknown buckets ignored)', () => {
    const out = eligibleStorageObjects(UID, { ...({ 'letter-photos': ['x/y.jpg'], 'postcard-artwork': ['p.jpg'] } as object) })
    expect(out).toEqual({ 'profile-marks': [], 'dispatch-photos': [] })
  })
})

describe('removeClosedAccountStorage — batched, server-side', () => {
  it('removes in batches of 100 per bucket', async () => {
    const { service, calls } = fakeService()
    const photos = Array.from({ length: 250 }, (_, i) => `${UID}/${i}.jpg`)
    expect(await removeClosedAccountStorage(service, UID, { 'profile-marks': [MARK], 'dispatch-photos': photos })).toBeNull()
    expect(calls.removes.map((r) => [r.bucket, r.paths.length])).toEqual([
      ['profile-marks', 1],
      ['dispatch-photos', 100],
      ['dispatch-photos', 100],
      ['dispatch-photos', 50],
    ])
  })

  it('reports a storage failure instead of hiding it', async () => {
    const { service } = fakeService({ failRemove: true })
    expect(await removeClosedAccountStorage(service, UID, { 'profile-marks': [MARK] })).toMatch(/^storage:profile-marks/)
  })
})

describe('disableClosedAuthUser — permanent Auth disablement', () => {
  it('clean account: banned and email replaced with a non-deliverable tombstone', async () => {
    const { service, calls } = fakeService()
    expect(await disableClosedAuthUser(service, UID)).toBeNull()
    expect(calls.authUpdates[0]).toMatchObject({ ban_duration: CLOSED_ACCOUNT_BAN_DURATION, email: tombstoneEmail(UID), email_confirm: true })
    expect(tombstoneEmail(UID)).toMatch(/\.invalid$/)
  })

  it.each([
    ['restricted', { enforcement: 'restricted' }],
    ['reported', { reports: 1 }],
    ['subject of a Safety case', { cases: 2 }],
  ])('%s account: banned but email retained (ban-evasion defence)', async (_label, opts) => {
    const { service, calls } = fakeService(opts)
    expect(await disableClosedAuthUser(service, UID)).toBeNull()
    expect(calls.authUpdates[0]).toMatchObject({ ban_duration: CLOSED_ACCOUNT_BAN_DURATION })
    expect(calls.authUpdates[0]).not.toHaveProperty('email')
  })

  it('if the email rewrite is refused, still bans (never leaves sign-in open)', async () => {
    const { service, calls } = fakeService({ failEmailUpdate: true })
    expect(await disableClosedAuthUser(service, UID)).toMatch(/^auth:email_not_scrubbed/)
    expect(calls.authUpdates[1]).toEqual({ ban_duration: CLOSED_ACCOUNT_BAN_DURATION, user_metadata: { account_closed: true } })
  })
})

describe('finalizeAccountClosure — records progress for retry', () => {
  it('success stamps storage_cleaned_at and auth_disabled_at with no error', async () => {
    const { service, calls } = fakeService()
    const result = await finalizeAccountClosure(service, UID, { 'profile-marks': [MARK] })
    expect(result).toEqual({ storageCleaned: true, authDisabled: true, error: null })
    expect(calls.closureUpdates[0]).toMatchObject({ last_error: null })
    expect(calls.closureUpdates[0]).toHaveProperty('storage_cleaned_at')
    expect(calls.closureUpdates[0]).toHaveProperty('auth_disabled_at')
  })

  it('an auth failure is recorded and reported — never a silent success', async () => {
    const { service, calls } = fakeService({ failBan: true })
    const result = await finalizeAccountClosure(service, UID, {})
    expect(result.authDisabled).toBe(false)
    expect(result.error).toMatch(/auth:/)
    expect(calls.closureUpdates[0]).not.toHaveProperty('auth_disabled_at')
    expect(calls.closureUpdates[0].last_error).toMatch(/auth:/)
  })
})
