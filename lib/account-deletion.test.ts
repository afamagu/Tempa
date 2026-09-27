import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CLOSED_ACCOUNT_BAN_DURATION,
  disableClosedAuthUser,
  eligibleStorageObjects,
  finalizeAccountClosure,
  removeClosedAccountStorage,
} from './account-deletion'

const UID = '00000000-0000-4000-8000-000000000001'
const MARK = '11111111-2222-4333-8444-555555555555.png'

type Calls = { removes: { bucket: string; paths: string[] }[]; authUpdates: Record<string, unknown>[]; softDeletes: [string, boolean][]; rpcs: [string, unknown][]; closureUpdates: Record<string, unknown>[]; closureFilters: [string, string][] }

function fakeService(
  opts: {
    /** account_auth_state() for this closing member (default 'deleted'). */
    state?: string | null
    stateError?: boolean
    failRemove?: boolean
    failSoftDelete?: boolean
    failBan?: boolean
    failClosureUpdate?: boolean
  } = {}
) {
  const calls: Calls = { removes: [], authUpdates: [], softDeletes: [], rpcs: [], closureUpdates: [], closureFilters: [] }
  const table = (name: string) => {
    const chain = {
      update: (values: Record<string, unknown>) => {
        calls.closureUpdates.push({ table: name, ...values })
        return {
          eq: async (column: string, value: string) => {
            calls.closureFilters.push([column, value])
            // The production refusal: service_role held no UPDATE on account_closures.
            return {
              error: opts.failClosureUpdate
                ? { code: '42501', message: 'permission denied for table account_closures' }
                : null,
            }
          },
        }
      },
    }
    return chain
  }
  const service = {
    from: table,
    rpc: async (fn: string, args: unknown) => {
      calls.rpcs.push([fn, args])
      if (opts.stateError) return { data: null, error: { code: '42501', message: 'permission denied' } }
      return { data: opts.state === undefined ? 'deleted' : opts.state, error: null }
    },
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
          if (opts.failBan) return { error: { message: 'auth down' } }
          return { error: null }
        },
        deleteUser: async (id: string, shouldSoftDelete: boolean) => {
          calls.softDeletes.push([id, shouldSoftDelete])
          return { error: opts.failSoftDelete ? { message: 'delete refused' } : null }
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

const BAN = { ban_duration: CLOSED_ACCOUNT_BAN_DURATION, user_metadata: { account_closed: true } }

describe('disableClosedAuthUser — Tempa state decides, never Safety history', () => {
  it('reads Tempa’s own state for this member only', async () => {
    const { service, calls } = fakeService()
    await disableClosedAuthUser(service, UID)
    expect(calls.rpcs).toEqual([['account_auth_state', { p_user_id: UID }]])
  })

  it('voluntary deletion: Auth identity SOFT-deleted (email/Google freed), never banned', async () => {
    const { service, calls } = fakeService({ state: 'deleted' })
    expect(await disableClosedAuthUser(service, UID)).toEqual({ mode: 'retired', error: null })
    expect(calls.softDeletes).toEqual([[UID, true]])
    expect(calls.authUpdates).toEqual([])
  })

  it.each(['deleted_suspended', 'permanently_banned'])(
    '%s: banned with identity kept — deletion cannot escape the sanction',
    async (state) => {
      const { service, calls } = fakeService({ state })
      expect(await disableClosedAuthUser(service, UID)).toEqual({ mode: 'banned', error: null })
      expect(calls.softDeletes).toEqual([])
      expect(calls.authUpdates).toEqual([BAN])
    }
  )

  it('the state cannot be read: fail safe — banned + identity kept, reported for follow-up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { service, calls } = fakeService({ stateError: true })
    expect(await disableClosedAuthUser(service, UID)).toEqual({ mode: 'banned', error: 'auth:state_unreadable' })
    expect(calls.softDeletes).toEqual([])
    expect(calls.authUpdates).toEqual([BAN])
    vi.mocked(console.error).mockRestore()
  })

  it('soft delete refused: still banned (never leaves sign-in open) and reported', async () => {
    const { service, calls } = fakeService({ failSoftDelete: true })
    expect(await disableClosedAuthUser(service, UID)).toEqual({ mode: 'banned', error: 'auth:not_retired:delete refused' })
    expect(calls.authUpdates).toEqual([BAN])
  })

  it('soft delete AND ban refused: reported as not disabled', async () => {
    const { service } = fakeService({ failSoftDelete: true, failBan: true })
    expect(await disableClosedAuthUser(service, UID)).toEqual({ mode: null, error: 'auth:auth down' })
  })

  it('never hard-deletes the Auth user (retained records keep their foreign keys)', async () => {
    const { service, calls } = fakeService()
    await disableClosedAuthUser(service, UID)
    expect(calls.softDeletes.every(([, soft]) => soft === true)).toBe(true)
  })
})

describe('finalizeAccountClosure — records progress for retry', () => {
  it('success stamps storage_cleaned_at and auth_disabled_at with no error', async () => {
    const { service, calls } = fakeService()
    const result = await finalizeAccountClosure(service, UID, { 'profile-marks': [MARK] })
    expect(result).toEqual({ storageCleaned: true, authDisabled: true, authMode: 'retired', error: null })
    expect(calls.closureUpdates[0]).toMatchObject({ last_error: null })
    expect(calls.closureUpdates[0]).toHaveProperty('storage_cleaned_at')
    expect(calls.closureUpdates[0]).toHaveProperty('auth_disabled_at')
  })

  it('an auth failure is recorded and reported — never a silent success', async () => {
    const { service, calls } = fakeService({ state: 'deleted_suspended', failBan: true })
    const result = await finalizeAccountClosure(service, UID, {})
    expect(result.authDisabled).toBe(false)
    expect(result.error).toMatch(/auth:/)
    expect(calls.closureUpdates[0]).not.toHaveProperty('auth_disabled_at')
    expect(calls.closureUpdates[0].last_error).toMatch(/auth:/)
  })
})

describe('finalizeAccountClosure — the progress record itself', () => {
  it('writes the three progress columns to account_closures, filtered by this user id only', async () => {
    const { service, calls } = fakeService()
    await finalizeAccountClosure(service, UID, {})
    expect(Object.keys(calls.closureUpdates[0]).sort()).toEqual(['auth_disabled_at', 'last_error', 'storage_cleaned_at', 'table'])
    expect(calls.closureUpdates[0].table).toBe('account_closures')
    expect(calls.closureFilters).toEqual([['user_id', UID]])
  })

  it('a refused update (42501) is surfaced and logged — never a silent success', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { service, calls } = fakeService({ failClosureUpdate: true })
      const result = await finalizeAccountClosure(service, UID, {})
      // the Auth retirement itself still happened and is reported
      expect(calls.softDeletes).toEqual([[UID, true]])
      expect(result.authDisabled).toBe(true)
      expect(result.error).toBe('record:42501:permission denied for table account_closures')
      expect(log).toHaveBeenCalledWith('[account-deletion] closure progress not recorded', {
        userId: UID,
        code: '42501',
        message: 'permission denied for table account_closures',
      })
    } finally {
      log.mockRestore()
    }
  })

  it('a refused update is appended to an earlier cleanup error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { service } = fakeService({ state: 'permanently_banned', failClosureUpdate: true, failBan: true })
      const result = await finalizeAccountClosure(service, UID, {})
      expect(result.error).toMatch(/^auth:auth down \| record:42501:/)
    } finally {
      log.mockRestore()
    }
  })

  it('logs nothing when the update succeeds', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { service } = fakeService()
      expect((await finalizeAccountClosure(service, UID, {})).error).toBeNull()
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
