import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'

// Cross-browser magic-link fix (2026-09-24) — same mocking conventions
// as app/auth/callback/route.test.ts (table-aware '@/lib/supabase/server'
// mock) and app/begin/sign-out-action.test.ts (next/navigation's
// redirect() throws internally in real Next.js, mocked the same way so
// a successful call is observed as "threw the expected redirect marker,"
// not as a normal return).

const mockVerifyOtp = vi.fn()
const mockProfileMaybeSingle = vi.fn()
const mockEligibilityMaybeSingle = vi.fn()
const mockLegalAcceptances = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { verifyOtp: mockVerifyOtp },
    from: (table: string) => {
      if (table === 'profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: mockProfileMaybeSingle }) }) }
      }
      if (table === 'account_eligibility') {
        return { select: () => ({ eq: () => ({ maybeSingle: mockEligibilityMaybeSingle }) }) }
      }
      if (table === 'legal_acceptances') {
        return { select: () => ({ eq: () => mockLegalAcceptances() }) }
      }
      throw new Error(`unexpected table in test mock: ${table}`)
    },
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`)
  },
}))

import { verifyMagicLink } from './verify-magic-link-action'

beforeEach(() => {
  mockVerifyOtp.mockReset()
  mockProfileMaybeSingle.mockReset()
  mockEligibilityMaybeSingle.mockReset()
  mockLegalAcceptances.mockReset()

  // Default: gate already satisfied, same convention as route.test.ts.
  mockEligibilityMaybeSingle.mockResolvedValue({ data: { status: 'eligible' } })
  mockLegalAcceptances.mockResolvedValue({
    data: [
      { document_type: 'terms_of_service', document_version: CURRENT_TERMS_VERSION },
      { document_type: 'community_guidelines', document_version: CURRENT_COMMUNITY_GUIDELINES_VERSION },
    ],
  })
})

async function redirectPath(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    throw new Error('expected a redirect to be thrown')
  } catch (e) {
    const message = (e as Error).message
    if (!message.startsWith('REDIRECT:')) throw e
    return message.slice('REDIRECT:'.length)
  }
}

describe('verifyMagicLink — calls verifyOtp with the exact extracted token_hash/type, never exchangeCodeForSession', () => {
  it('calls supabase.auth.verifyOtp with token_hash and type, and never touches exchangeCodeForSession', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    await redirectPath(verifyMagicLink('real-token-hash-value', 'magiclink', null))

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'real-token-hash-value', type: 'magiclink' })
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1)
    // The mock Supabase client above defines no exchangeCodeForSession
    // at all — if the action ever called it, this would throw
    // "... is not a function," which none of these tests do.
  })

  it('a successful verifyOtp enters the SAME account-entry routing Google uses — an existing member goes to /home by default', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', null))

    expect(destination).toBe('/home')
  })

  it('honors a sanitized requested `next` destination for an existing member', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', '/letters'))

    expect(destination).toBe('/letters')
  })

  it('a brand new member (no profile yet) goes to /profile onboarding, even if `next` was supplied', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: null })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', '/letters'))

    expect(destination).toBe('/profile')
  })

  it('a brand-new account with no eligibility state yet is sent to /begin, with `next` preserved', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })
    mockEligibilityMaybeSingle.mockResolvedValue({ data: null })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', '/letters'))

    expect(destination).toBe('/begin?next=%2Fletters')
  })

  it('accepts the other allowlisted type literal ("email") the same way', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    await redirectPath(verifyMagicLink('tok', 'email', null))

    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'tok', type: 'email' })
  })
})

describe('verifyMagicLink — invalid/expired/malformed verification fails safely', () => {
  it('a verifyOtp error redirects to /sign-in?error=link_expired, never exposing the raw provider message', async () => {
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired or is invalid', code: 'otp_expired', name: 'AuthApiError' },
    })

    const destination = await redirectPath(verifyMagicLink('stale-token', 'magiclink', null))

    expect(destination).toBe('/sign-in?error=link_expired')
  })

  it('logs the error safely (message/code/name) server-side only, never the token itself', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockVerifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired or is invalid', code: 'otp_expired', name: 'AuthApiError' },
    })

    await redirectPath(verifyMagicLink('super-secret-token-value', 'magiclink', null))

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/confirm] verifyOtp failed',
      expect.objectContaining({ message: 'Token has expired or is invalid', code: 'otp_expired', name: 'AuthApiError' })
    )
    const loggedPayloads = consoleErrorSpy.mock.calls.map((call) => JSON.stringify(call))
    expect(loggedPayloads.some((s) => s.includes('super-secret-token-value'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('verifyOtp succeeds with no error but also no user (edge case) still reaches link_expired, not a crash', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: null }, error: null })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', null))

    expect(destination).toBe('/sign-in?error=link_expired')
  })

  it('never calls the account-entry tables at all when verifyOtp fails', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'bad', code: 'x', name: 'AuthApiError' } })

    await redirectPath(verifyMagicLink('tok', 'magiclink', null))

    expect(mockProfileMaybeSingle).not.toHaveBeenCalled()
  })
})

// Independent audit correction — a Server Action is itself a reachable
// server endpoint (a stable action id a client could invoke directly
// with crafted arguments, entirely bypassing app/auth/confirm/page.tsx's
// own parsing/allowlisting and its TypeScript types). These tests call
// verifyMagicLink directly with values that page.tsx's own validation
// would never actually produce — simulating exactly that direct,
// bypassing invocation — and prove the action's OWN runtime checks
// still hold regardless.
describe('verifyMagicLink — defensive runtime validation for direct/bypassing Server Action invocation', () => {
  it('an arbitrary type outside the allowlist (e.g. "recovery") never calls verifyOtp — redirects straight to link_expired', async () => {
    const destination = await redirectPath(
      verifyMagicLink('some-token', 'recovery' as unknown as Parameters<typeof verifyMagicLink>[1], null)
    )

    expect(destination).toBe('/sign-in?error=link_expired')
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('"signup" (a real EmailOtpType value, but never a Tempa magic-link sign-in) never calls verifyOtp', async () => {
    const destination = await redirectPath(
      verifyMagicLink('some-token', 'signup' as unknown as Parameters<typeof verifyMagicLink>[1], null)
    )

    expect(destination).toBe('/sign-in?error=link_expired')
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('an empty token never calls verifyOtp', async () => {
    const destination = await redirectPath(verifyMagicLink('', 'magiclink', null))

    expect(destination).toBe('/sign-in?error=link_expired')
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('a non-string token (a direct-invocation forgery, impossible via the real page) never calls verifyOtp', async () => {
    const destination = await redirectPath(
      verifyMagicLink(null as unknown as string, 'magiclink', null)
    )

    expect(destination).toBe('/sign-in?error=link_expired')
    expect(mockVerifyOtp).not.toHaveBeenCalled()
  })

  it('an external next (https://evil.example.com) is never honored — verifyOtp still runs (token/type were valid) but the destination falls back to /home, never the external URL', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', 'https://evil.example.com'))

    expect(destination).toBe('/home')
    expect(destination).not.toContain('evil.example.com')
  })

  it('a protocol-relative next (//evil.example.com) is never honored either', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', '//evil.example.com'))

    expect(destination).toBe('/home')
    expect(destination).not.toContain('evil.example.com')
  })

  it('a genuinely internal next (/letters) still works after re-sanitization', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const destination = await redirectPath(verifyMagicLink('tok', 'magiclink', '/letters'))

    expect(destination).toBe('/letters')
  })

  it('both allowlisted types ("magiclink" and "email") still verify normally, unaffected by the new runtime checks', async () => {
    mockVerifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    await redirectPath(verifyMagicLink('tok-1', 'magiclink', null))
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'tok-1', type: 'magiclink' })

    mockVerifyOtp.mockClear()
    await redirectPath(verifyMagicLink('tok-2', 'email', null))
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: 'tok-2', type: 'email' })
  })
})
