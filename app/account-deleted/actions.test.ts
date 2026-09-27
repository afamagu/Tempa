import { describe, it, expect, vi } from 'vitest'

const signOut = vi.fn(async (opts: unknown) => ({ error: null, opts }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { signOut } }) }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  },
}))

import { startNewAccount } from './actions'

describe('startNewAccount — Create a new account after a voluntary deletion', () => {
  it('clears any leftover local session, then opens the normal join flow', async () => {
    await expect(startNewAccount()).rejects.toThrow('NEXT_REDIRECT:/sign-in?intent=join')
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('still opens the join flow if the local sign-out reports an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signOut.mockResolvedValueOnce({ error: { message: 'no session', name: 'AuthSessionMissingError' } } as never)
    await expect(startNewAccount()).rejects.toThrow('NEXT_REDIRECT:/sign-in?intent=join')
  })
})
