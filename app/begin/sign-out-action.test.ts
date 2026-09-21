import { describe, it, expect, vi, beforeEach } from 'vitest'

// Independent audit correction — the previous try/catch-around-signOut()
// implementation only ever exercised a THROWN exception; Supabase's
// signOut() actually resolves with `{ error }` rather than throwing for
// an ordinary failure, so that code path was never genuinely tested.
// This file specifically covers the RETURNED-error shape (mocking
// signOut() to resolve with a non-null `error`, never to reject/throw),
// matching app/auth/callback/route.test.ts's own established mocking
// conventions for '@/lib/supabase/server'. next/navigation's redirect()
// throws internally in real Next.js (to unwind and perform the actual
// redirect) — mocked here the same way, so a successful call is
// observed as "threw the expected redirect marker," not as a normal
// return.

const mockSignOut = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signOut: mockSignOut },
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))

import { signOutAndReturnToSignIn } from './sign-out-action'

beforeEach(() => {
  mockSignOut.mockReset()
})

describe('signOutAndReturnToSignIn — successful sign-out', () => {
  it('calls supabase.auth.signOut() and redirects to /sign-in', async () => {
    mockSignOut.mockResolvedValue({ error: null })

    await expect(signOutAndReturnToSignIn()).rejects.toThrow('REDIRECT:/sign-in')
    expect(mockSignOut).toHaveBeenCalledTimes(1)
  })

  it('calls signOut with no arguments — does not change global/local sign-out scope', () => {
    expect(mockSignOut).not.toHaveBeenCalledWith(expect.objectContaining({ scope: expect.anything() }))
  })
})

describe('signOutAndReturnToSignIn — a RETURNED error (not a thrown exception)', () => {
  it('is inspected via the destructured { error } result, not caught via try/catch around a throw', async () => {
    mockSignOut.mockResolvedValue({ error: { message: 'network hiccup', name: 'AuthApiError' } })

    // signOut() itself never rejects here — only resolves with a
    // truthy `error` field — so this proves the returned-error branch
    // is actually reached and handled, not merely a catch block that
    // would only fire on a thrown exception.
    await expect(signOutAndReturnToSignIn()).rejects.toThrow('REDIRECT:/sign-in')
  })

  it('logs the error server-side (message + name), the same restrained shape as [auth/callback] code exchange failed', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignOut.mockResolvedValue({ error: { message: 'network hiccup', name: 'AuthApiError' } })

    await expect(signOutAndReturnToSignIn()).rejects.toThrow('REDIRECT:/sign-in')

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[begin] sign-out failed',
      expect.objectContaining({ message: 'network hiccup', name: 'AuthApiError' })
    )
    consoleErrorSpy.mockRestore()
  })

  it('still redirects to /sign-in — a sign-out failure never strands the member on /begin', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignOut.mockResolvedValue({ error: { message: 'boom', name: 'AuthApiError' } })

    await expect(signOutAndReturnToSignIn()).rejects.toThrow('REDIRECT:/sign-in')

    consoleErrorSpy.mockRestore()
  })

  it('never exposes the raw provider error text to the member — the redirect destination is always exactly /sign-in, never carrying an error query param or message', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignOut.mockResolvedValue({ error: { message: 'super secret internal detail', name: 'AuthApiError' } })

    let caught: unknown
    try {
      await signOutAndReturnToSignIn()
    } catch (e) {
      caught = e
    }

    expect((caught as Error).message).toBe('REDIRECT:/sign-in')
    expect((caught as Error).message).not.toContain('super secret internal detail')
    consoleErrorSpy.mockRestore()
  })

  it('does NOT log when there is no error — logging is conditional on a genuinely returned error', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignOut.mockResolvedValue({ error: null })

    await expect(signOutAndReturnToSignIn()).rejects.toThrow('REDIRECT:/sign-in')

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
