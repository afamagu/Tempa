import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { staff: true, syncResult: null as string | null, syncCalls: [] as string[] }

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ service: true }) }))
vi.mock('@/lib/admin', () => ({ isStaff: async () => state.staff }))
vi.mock('@/lib/account-auth-state', () => ({
  syncAuthBanWithTempa: async (_service: unknown, userId: string) => {
    state.syncCalls.push(userId)
    return state.syncResult
  },
}))

import { syncMemberAuthAccess } from './auth-access-action'

const UID = '00000000-0000-4000-8000-000000000001'

beforeEach(() => {
  state.staff = true
  state.syncResult = null
  state.syncCalls = []
})

describe('syncMemberAuthAccess — staff-only, derived from the database', () => {
  it('staff: syncs exactly that member', async () => {
    expect(await syncMemberAuthAccess(UID)).toEqual({ ok: true })
    expect(state.syncCalls).toEqual([UID])
  })

  it('non-staff: refused, nothing synced', async () => {
    state.staff = false
    expect(await syncMemberAuthAccess(UID)).toEqual({ ok: false })
    expect(state.syncCalls).toEqual([])
  })

  it('a malformed id is refused before any call', async () => {
    for (const bad of ['', 'not-a-uuid', `${UID}' or 1=1`, 42 as unknown as string]) {
      expect(await syncMemberAuthAccess(bad)).toEqual({ ok: false })
    }
    expect(state.syncCalls).toEqual([])
  })

  it('a failed sync is reported, not hidden', async () => {
    state.syncResult = 'auth:down'
    expect(await syncMemberAuthAccess(UID)).toEqual({ ok: false })
  })

  it('both admin status surfaces call it after a successful status change', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    for (const f of ['account-status-actions.tsx', 'moderation/needs-attention/case-account-intervention-actions.tsx']) {
      const src = readFileSync(path.join(__dirname, f), 'utf8')
      expect(src).toContain('await syncMemberAuthAccess(userId)')
    }
  })
})
