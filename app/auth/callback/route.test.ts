import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION } from '@/lib/legal'

// Checkpoint 1, Phase B — no test file existed for this route at all
// before this checkpoint, despite it being the exact route the
// production Magic Link/Google OAuth defects live in. Mocks the two
// dependencies this route actually touches (@/lib/supabase/server and
// next/headers) rather than a real Supabase client/Next.js request
// context, matching this codebase's own established mocking
// conventions elsewhere (e.g. app/letters/letterbox-search.test.tsx).
//
// Adult Eligibility + Legal Acceptance Gate — the mock is now
// table-aware (profiles / account_eligibility / legal_acceptances each
// resolve through their OWN mock function) since the route now reads
// all three per request, in parallel. Every PRE-EXISTING test below
// keeps its original intent unchanged; the default eligibility/legal
// mocks are set to an already-satisfied state in beforeEach precisely
// so those pre-existing profile-onboarding-stage assertions continue
// to exercise exactly what they did before this gate existed. New
// gate-specific tests are added in their own describe block below.

const mockExchangeCodeForSession = vi.fn()
const mockProfileMaybeSingle = vi.fn()
const mockEligibilityMaybeSingle = vi.fn()
const mockLegalAcceptances = vi.fn()
const mockCookiesGetAll = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: mockExchangeCodeForSession },
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

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: mockCookiesGetAll }),
}))

beforeEach(() => {
  mockExchangeCodeForSession.mockReset()
  mockProfileMaybeSingle.mockReset()
  mockEligibilityMaybeSingle.mockReset()
  mockLegalAcceptances.mockReset()
  mockCookiesGetAll.mockReset()
  mockCookiesGetAll.mockReturnValue([])

  // Default: gate already satisfied — an eligible adult with current
  // legal acceptance — so every pre-existing test below (written
  // before this gate existed) continues to exercise ONLY the profile-
  // onboarding-stage routing it originally targeted.
  mockEligibilityMaybeSingle.mockResolvedValue({ data: { status: 'eligible' } })
  mockLegalAcceptances.mockResolvedValue({
    data: [
      { document_type: 'terms_of_service', document_version: CURRENT_TERMS_VERSION },
      { document_type: 'community_guidelines', document_version: CURRENT_COMMUNITY_GUIDELINES_VERSION },
    ],
  })
})

function locationOf(response: Response): string | null {
  return response.headers.get('location')
}

describe('GET /auth/callback — a valid code (Google-style or Magic-Link-style, identical downstream) exchanges the session', () => {
  it('calls exchangeCodeForSession with the exact code from the query string', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    await GET(new Request('https://jointempa.com/auth/callback?code=real-auth-code-123'))

    expect(mockExchangeCodeForSession).toHaveBeenCalledWith('real-auth-code-123')
  })

  it('an existing member (has a profile) is redirected to /home by default', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/home')
  })

  it('honors a sanitized `next` destination for an existing member', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc&next=%2Fletters'))

    expect(locationOf(res)).toBe('https://jointempa.com/letters')
  })

  it('a brand new member (no profile yet) always goes to /profile onboarding, even if `next` was supplied', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: null })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc&next=%2Fletters'))

    expect(locationOf(res)).toBe('https://jointempa.com/profile')
  })

  it('an unsanitized/external `next` is never honored — falls back to /home', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc&next=https%3A%2F%2Fevil.example.com'))

    expect(locationOf(res)).toBe('https://jointempa.com/home')
  })

  it.each([
    ['mark', '/profile/mark'],
    ['question', '/profile/question'],
  ])('does not let a %s-stage member use `next` to bypass onboarding', async (stage, expected) => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: stage } })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc&next=%2Fletters'))
    expect(locationOf(res)).toBe(`https://jointempa.com${expected}`)
  })
})

describe('GET /auth/callback — Adult Eligibility + Legal Acceptance Gate', () => {
  it('a brand-new account with no eligibility state yet is sent to /begin, with `next` preserved, even with a complete-looking profile', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })
    mockEligibilityMaybeSingle.mockResolvedValue({ data: null })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc&next=%2Fletters'))

    expect(locationOf(res)).toBe('https://jointempa.com/begin?next=%2Fletters')
  })

  it('an ineligible account is sent to /begin regardless of profile completeness', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })
    mockEligibilityMaybeSingle.mockResolvedValue({ data: { status: 'ineligible' } })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/begin?next=%2Fhome')
  })

  it('eligible but missing current legal acceptance is sent to /begin', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })
    mockEligibilityMaybeSingle.mockResolvedValue({ data: { status: 'eligible' } })
    mockLegalAcceptances.mockResolvedValue({ data: [] })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/begin?next=%2Fhome')
  })

  it('an OLD accepted Terms version does not count as current — still sent to /begin', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: { id: 'user-1', onboarding_stage: 'complete' } })
    mockEligibilityMaybeSingle.mockResolvedValue({ data: { status: 'eligible' } })
    mockLegalAcceptances.mockResolvedValue({
      data: [
        { document_type: 'terms_of_service', document_version: 'some-old-version' },
        { document_type: 'community_guidelines', document_version: CURRENT_COMMUNITY_GUIDELINES_VERSION },
      ],
    })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/begin?next=%2Fhome')
  })

  it('eligible + legally current + no profile still goes to /profile, not /begin', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null })
    mockProfileMaybeSingle.mockResolvedValue({ data: null })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/profile')
  })
})

describe('GET /auth/callback — code exchange failure reaches the controlled auth_failed handling', () => {
  it('redirects to /sign-in?error=auth_failed when exchangeCodeForSession errors', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'invalid request: both auth code and code verifier should be non-empty', code: 'bad_code_verifier', name: 'AuthApiError' },
    })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=stale-or-mismatched-code'))

    expect(locationOf(res)).toBe('https://jointempa.com/sign-in?error=auth_failed')
  })

  it('logs the error safely (message/code/name), never the auth code itself', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: { message: 'Token has expired or is invalid', code: 'otp_expired', name: 'AuthApiError' },
    })

    await GET(new Request('https://jointempa.com/auth/callback?code=some-code-value'))

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/callback] code exchange failed',
      expect.objectContaining({ message: 'Token has expired or is invalid', code: 'otp_expired', name: 'AuthApiError' })
    )
    const loggedPayloads = consoleErrorSpy.mock.calls.map((call) => JSON.stringify(call))
    expect(loggedPayloads.some((s) => s.includes('some-code-value'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('code present, exchange succeeds with no error but also no user (edge case) still reaches auth_failed, not a crash', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null })

    const res = await GET(new Request('https://jointempa.com/auth/callback?code=abc'))

    expect(locationOf(res)).toBe('https://jointempa.com/sign-in?error=auth_failed')
  })
})

describe('GET /auth/callback — provider-supplied query error (e.g. OAuth denial)', () => {
  it('redirects to auth_failed and logs the provider error safely', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await GET(
      new Request('https://jointempa.com/auth/callback?error=access_denied&error_description=User+denied+access')
    )

    expect(locationOf(res)).toBe('https://jointempa.com/sign-in?error=auth_failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/callback] provider returned an error',
      expect.objectContaining({ error: 'access_denied', description: 'User denied access' })
    )
    // exchangeCodeForSession must never be attempted when the provider
    // itself already reported an error and there is no code at all.
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe('GET /auth/callback — no code AND no query-string error (the Phase A blind spot)', () => {
  it('is now diagnosed safely rather than silently falling through', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCookiesGetAll.mockReturnValue([
      { name: 'sb-abc-auth-token-code-verifier', value: 'should-never-be-logged' },
      { name: 'sb-abc-auth-token', value: 'should-never-be-logged-either' },
    ])

    const res = await GET(new Request('https://jointempa.com/auth/callback'))

    expect(locationOf(res)).toBe('https://jointempa.com/sign-in?error=auth_failed')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/callback] auth_callback_no_code_no_query_error',
      expect.objectContaining({ reason: 'auth_callback_no_code_no_query_error', verifierCookieCount: 1 })
    )
    consoleErrorSpy.mockRestore()
  })

  it('never logs cookie VALUES — only a count', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCookiesGetAll.mockReturnValue([{ name: 'sb-abc-auth-token-code-verifier', value: 'super-secret-verifier-value' }])

    await GET(new Request('https://jointempa.com/auth/callback'))

    const loggedPayloads = consoleErrorSpy.mock.calls.map((call) => JSON.stringify(call))
    expect(loggedPayloads.some((s) => s.includes('super-secret-verifier-value'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('logs only query PARAMETER NAMES, never their values, when some unrecognized params are present', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await GET(new Request('https://jointempa.com/auth/callback?some_unexpected_param=super-secret-token-like-value'))

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[auth/callback] auth_callback_no_code_no_query_error',
      expect.objectContaining({ paramNames: ['some_unexpected_param'] })
    )
    const loggedPayloads = consoleErrorSpy.mock.calls.map((call) => JSON.stringify(call))
    expect(loggedPayloads.some((s) => s.includes('super-secret-token-like-value'))).toBe(false)
    consoleErrorSpy.mockRestore()
  })

  it('exchangeCodeForSession is never called when there is no code at all', async () => {
    await GET(new Request('https://jointempa.com/auth/callback'))
    expect(mockExchangeCodeForSession).not.toHaveBeenCalled()
  })
})
