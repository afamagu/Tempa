import { beforeEach, describe, expect, it, vi } from 'vitest'
const { getUser, rpc } = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }))
import { continueWithoutIntroduction } from './continue-later-action'
beforeEach(() => { vi.clearAllMocks(); getUser.mockResolvedValue({ data: { user: { id: 'viewer' } } }); rpc.mockResolvedValue({ error: null }) })
describe('continue without an introduction', () => {
  it('uses the signed-in member RPC without a supplied user id or answer', async () => {
    expect(await continueWithoutIntroduction()).toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledWith('defer_flagship_onboarding')
  })
  it('refuses signed-out callers before the RPC', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await continueWithoutIntroduction()).toEqual({ ok: false })
    expect(rpc).not.toHaveBeenCalled()
  })
  it('does not report success or expose SQL details if deferral fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'private database details' } })
    expect(await continueWithoutIntroduction()).toEqual({ ok: false })
  })
})
