import { describe, it, expect, vi, beforeEach } from 'vitest'

// The server action with its three collaborators mocked at the module
// boundary: the member's own session client, the service-role client
// and Next's redirect.

const state = {
  user: { id: 'member-a' } as { id: string } | null,
  rpcResult: { data: { storage_objects: { 'profile-marks': ['m.png'] } }, error: null } as { data: unknown; error: { message: string } | null },
  rpcCalls: [] as { fn: string; args: unknown }[],
  signOutCalls: [] as unknown[],
  finalizeResult: { storageCleaned: true, authDisabled: true, error: null } as { storageCleaned: boolean; authDisabled: boolean; error: string | null },
  finalizeCalls: [] as unknown[][],
  serviceThrows: false,
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      signOut: async (opts: unknown) => {
        state.signOutCalls.push(opts)
        return { error: null }
      },
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args })
      return state.rpcResult
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    if (state.serviceThrows) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
    return { service: true }
  },
}))
vi.mock('@/lib/account-deletion', async (orig) => ({
  ...(await orig<typeof import('@/lib/account-deletion')>()),
  finalizeAccountClosure: async (...args: unknown[]) => {
    state.finalizeCalls.push(args)
    return state.finalizeResult
  },
}))
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`)
})
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }))
vi.mock('server-only', () => ({}))

const { deleteMyAccount } = await import('./actions')

beforeEach(() => {
  state.user = { id: 'member-a' }
  state.rpcResult = { data: { storage_objects: { 'profile-marks': ['m.png'] } }, error: null }
  state.rpcCalls = []
  state.signOutCalls = []
  state.finalizeResult = { storageCleaned: true, authDisabled: true, error: null }
  state.finalizeCalls = []
  state.serviceThrows = false
  redirect.mockClear()
})

describe('deleteMyAccount', () => {
  it('18. requires the exact DELETE confirmation — nothing is called otherwise', async () => {
    for (const typed of ['', 'delete', 'DELETE ', 'Delete']) {
      expect(await deleteMyAccount(typed)).toEqual({ ok: false, error: 'Type DELETE to confirm.' })
    }
    expect(state.rpcCalls).toEqual([])
  })

  it('anonymous caller: refused before any database call', async () => {
    state.user = null
    expect(await deleteMyAccount('DELETE')).toMatchObject({ ok: false })
    expect(state.rpcCalls).toEqual([])
  })

  it('2. no target parameter: the RPC is called with no arguments; the member is the session user', async () => {
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT')
    expect(state.rpcCalls).toEqual([{ fn: 'close_my_account', args: undefined }])
    expect(state.finalizeCalls[0][1]).toBe('member-a')
    expect(deleteMyAccount.length).toBe(1)
  })

  it('19. success: storage/auth finalized, signed out everywhere, redirected to the public confirmation', async () => {
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT:/account-deleted')
    expect(state.finalizeCalls[0][2]).toEqual({ 'profile-marks': ['m.png'] })
    expect(state.signOutCalls).toEqual([{ scope: 'global' }])
  })

  it('20. database failure: honest error, nothing claimed, no sign-out, no redirect', async () => {
    state.rpcResult = { data: null, error: { message: 'something internal' } }
    expect(await deleteMyAccount('DELETE')).toEqual({ ok: false, error: 'We couldn’t delete your account. Nothing has been changed — please try again.' })
    expect(redirect).not.toHaveBeenCalled()
    expect(state.signOutCalls).toEqual([])
    expect(state.finalizeCalls).toEqual([])
  })

  it('17. staff refusal message is shown as-is', async () => {
    state.rpcResult = { data: null, error: { message: 'Staff accounts are closed by Tempa administrators.' } }
    expect(await deleteMyAccount('DELETE')).toEqual({ ok: false, error: 'Staff accounts are closed by Tempa administrators.' })
  })

  it('20. closed but cleanup incomplete: signed out and told plainly (pending page), never "deleted"', async () => {
    state.finalizeResult = { storageCleaned: true, authDisabled: false, error: 'auth:down' }
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT:/account-deleted?cleanup=pending')
    expect(state.signOutCalls).toEqual([{ scope: 'global' }])
  })

  it('20. missing service-role configuration: still closed, reported as pending', async () => {
    state.serviceThrows = true
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT:/account-deleted?cleanup=pending')
  })
})
