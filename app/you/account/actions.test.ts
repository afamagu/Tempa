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

const { deleteMyAccount, deactivateMyAccount, reactivateMyAccount } = await import('./actions')

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

  it('2. no target account: the RPC gets only the optional reason; the member is the session user', async () => {
    await expect(deleteMyAccount('DELETE')).rejects.toThrow('NEXT_REDIRECT')
    expect(state.rpcCalls).toEqual([{ fn: 'close_my_account', args: { p_reason_code: null, p_reason_detail: null } }])
    expect(state.finalizeCalls[0][1]).toBe('member-a')
  })

  it('I. deletion reason is optional; detail only travels with Something else; unknown codes dropped', async () => {
    await expect(deleteMyAccount('DELETE', { reasonCode: 'something_else', reasonDetail: '  moving on  ' })).rejects.toThrow('NEXT_REDIRECT')
    await expect(deleteMyAccount('DELETE', { reasonCode: 'not_using_tempa', reasonDetail: 'ignored' })).rejects.toThrow('NEXT_REDIRECT')
    await expect(deleteMyAccount('DELETE', { reasonCode: 'need_a_break', reasonDetail: '' })).rejects.toThrow('NEXT_REDIRECT')
    expect(state.rpcCalls.map((c) => c.args)).toEqual([
      { p_reason_code: 'something_else', p_reason_detail: 'moving on' },
      { p_reason_code: 'not_using_tempa', p_reason_detail: null },
      { p_reason_code: null, p_reason_detail: null },
    ])
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

  it('20. a failed close_my_account is logged server-side with code/message/details/hint — never shown to the member', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.rpcResult = {
      data: null,
      error: {
        code: '23503',
        message: 'update or delete on table "dispatches" violates foreign key constraint "dispatch_replies_dispatch_id_fkey" on table "dispatch_replies"',
        details: 'Key (id)=(abc) is still referenced from table "dispatch_replies".',
        hint: null,
      } as never,
    }
    const result = await deleteMyAccount('DELETE', { reasonCode: 'something_else', reasonDetail: 'test account' })
    expect(result).toEqual({ ok: false, error: 'We couldn’t delete your account. Nothing has been changed — please try again.' })
    expect(JSON.stringify(result)).not.toContain('dispatch_replies')
    expect(logged).toHaveBeenCalledWith('[account-deletion] close_my_account failed', {
      userId: 'member-a',
      code: '23503',
      message: expect.stringContaining('dispatch_replies_dispatch_id_fkey'),
      details: expect.stringContaining('still referenced'),
      hint: null,
    })
    logged.mockRestore()
  })

  it('20. no data and no error is also logged (never silent)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    state.rpcResult = { data: null, error: null }
    await deleteMyAccount('DELETE')
    expect(logged).toHaveBeenCalledWith('[account-deletion] close_my_account failed', expect.objectContaining({ userId: 'member-a', message: 'no data returned' }))
    logged.mockRestore()
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

describe('deactivateMyAccount / reactivateMyAccount — Take a break', () => {
  it('A. deactivates self only (reason optional) and goes to the paused page', async () => {
    await expect(deactivateMyAccount()).rejects.toThrow('NEXT_REDIRECT:/account-paused')
    await expect(deactivateMyAccount({ reasonCode: 'something_else', reasonDetail: ' quiet ' })).rejects.toThrow('NEXT_REDIRECT:/account-paused')
    expect(state.rpcCalls).toEqual([
      { fn: 'deactivate_my_account', args: { p_reason_code: null, p_reason_detail: null } },
      { fn: 'deactivate_my_account', args: { p_reason_code: 'something_else', p_reason_detail: 'quiet' } },
    ])
    expect(state.signOutCalls).toEqual([])
  })

  it('a failed pause says nothing changed and stays put', async () => {
    state.rpcResult = { data: null, error: { message: 'boom' } }
    expect(await deactivateMyAccount()).toEqual({ ok: false, error: 'We couldn’t pause your account. Nothing has been changed — please try again.' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('Return to Tempa explicitly reactivates, then goes home', async () => {
    await expect(reactivateMyAccount()).rejects.toThrow('NEXT_REDIRECT:/home')
    expect(state.rpcCalls).toEqual([{ fn: 'reactivate_my_account', args: undefined }])
  })

  it('a failed return keeps the member on the paused page with an honest message', async () => {
    state.rpcResult = { data: null, error: { message: 'boom' } }
    expect(await reactivateMyAccount()).toEqual({ ok: false, error: 'We couldn’t reopen your account just now. Please try again.' })
  })
})
