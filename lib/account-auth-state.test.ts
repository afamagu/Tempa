import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PERMANENT_AUTH_BAN_DURATION,
  readAccountAuthState,
  readAccountAuthStateForEmailLink,
  refusedSignInError,
  syncAuthBanWithTempa,
} from './account-auth-state'

const UID = '00000000-0000-4000-8000-000000000001'

function fakeService(state: unknown, opts: { rpcError?: boolean; authError?: boolean } = {}) {
  const rpcs: [string, unknown][] = []
  const authUpdates: [string, Record<string, unknown>][] = []
  const service = {
    rpc: async (fn: string, args: unknown) => {
      rpcs.push([fn, args])
      return opts.rpcError ? { data: null, error: { code: 'x', message: 'down' } } : { data: state, error: null }
    },
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: Record<string, unknown>) => {
          authUpdates.push([id, attrs])
          return { error: opts.authError ? { message: 'auth down' } : null }
        },
      },
    },
  } as unknown as SupabaseClient
  return { service, rpcs, authUpdates }
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('readAccountAuthState — Tempa’s own answer, service role only', () => {
  it('calls account_auth_state for exactly this user', async () => {
    const { service, rpcs } = fakeService('deleted')
    expect(await readAccountAuthState(service, UID)).toBe('deleted')
    expect(rpcs).toEqual([['account_auth_state', { p_user_id: UID }]])
  })

  it('an unknown value or an error is null (callers fail safe)', async () => {
    expect(await readAccountAuthState(fakeService('something').service, UID)).toBeNull()
    expect(await readAccountAuthState(fakeService('deleted', { rpcError: true }).service, UID)).toBeNull()
  })

  it('the email-link lookup passes the hash and never logs it', async () => {
    const { service, rpcs } = fakeService(null, { rpcError: true })
    expect(await readAccountAuthStateForEmailLink(service, 'hash-value-never-logged')).toBeNull()
    expect(rpcs).toEqual([['account_auth_state_for_email_link', { p_token_hash: 'hash-value-never-logged' }]])
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('hash-value-never-logged')
  })
})

describe('refusedSignInError — deleted, suspended-deleted, banned and unknown never conflated', () => {
  it.each([
    ['deleted', 'account_deleted'],
    ['deleted_suspended', 'account_deleted_unavailable'],
    ['permanently_banned', 'account_banned'],
    ['suspended', 'account_unavailable'],
    ['none', 'account_unavailable'],
    [null, 'account_unavailable'],
  ] as const)('%s -> %s', (state, param) => {
    expect(refusedSignInError(state)).toBe(param)
  })
})

describe('syncAuthBanWithTempa — Auth follows the permanent-ban decision only', () => {
  it('permanently banned -> Auth-banned for ~100 years (identity kept: nothing else changed)', async () => {
    const { service, authUpdates } = fakeService('permanently_banned')
    expect(await syncAuthBanWithTempa(service, UID)).toBeNull()
    expect(authUpdates).toEqual([[UID, { ban_duration: PERMANENT_AUTH_BAN_DURATION }]])
  })

  it.each(['none', 'suspended'])('%s -> Auth ban lifted (suspension/restriction never block sign-in)', async (state) => {
    const { service, authUpdates } = fakeService(state)
    expect(await syncAuthBanWithTempa(service, UID)).toBeNull()
    expect(authUpdates).toEqual([[UID, { ban_duration: 'none' }]])
  })

  it.each(['deleted', 'deleted_suspended'])('%s -> untouched (account deletion owns that identity)', async (state) => {
    const { service, authUpdates } = fakeService(state)
    expect(await syncAuthBanWithTempa(service, UID)).toBeNull()
    expect(authUpdates).toEqual([])
  })

  it('unreadable state -> nothing changed, reported', async () => {
    const { service, authUpdates } = fakeService(null, { rpcError: true })
    expect(await syncAuthBanWithTempa(service, UID)).toBe('state_unreadable')
    expect(authUpdates).toEqual([])
  })

  it('Auth refusal is reported', async () => {
    const { service } = fakeService('permanently_banned', { authError: true })
    expect(await syncAuthBanWithTempa(service, UID)).toBe('auth:auth down')
  })
})
