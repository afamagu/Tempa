import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createGoogleNonce,
  googleIdentityClientId,
  signInWithGoogleIdToken,
  GOOGLE_CAPTCHA_FAILED,
  GOOGLE_SIGN_IN_FAILED,
} from '@/lib/google-identity'

// Google sign-in via Google Identity Services + Supabase signInWithIdToken
// (the chooser names Tempa's origin, not the Supabase project host).

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

const getUser = vi.fn()
const resolvePostAuthDestination = vi.fn()
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }))
vi.mock('@/lib/post-auth-destination', () => ({
  resolvePostAuthDestination: (...args: unknown[]) => resolvePostAuthDestination(...args),
}))

function fakeSupabase(result: unknown) {
  const signInWithIdToken = vi.fn(async () => result)
  return { client: { auth: { signInWithIdToken } } as never, signInWithIdToken }
}

describe('nonce', () => {
  it('Google receives SHA-256(raw) in hex; Supabase receives raw — fresh every time', async () => {
    const a = await createGoogleNonce()
    const b = await createGoogleNonce()
    expect(a.raw).toMatch(/^[0-9a-f]{64}$/)
    expect(a.hashed).toBe(createHash('sha256').update(a.raw).digest('hex'))
    expect(a.raw).not.toBe(b.raw)
  })
})

describe('client id gate', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('is off unless NEXT_PUBLIC_GOOGLE_CLIENT_ID is set (the redirect flow stays in use)', () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', '')
    expect(googleIdentityClientId()).toBeNull()
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', ' 123-abc.apps.googleusercontent.com ')
    expect(googleIdentityClientId()).toBe('123-abc.apps.googleusercontent.com')
  })
})

describe('session establishment (signInWithGoogleIdToken)', () => {
  const session = { data: { session: { access_token: 'a' }, user: { id: 'u1' } }, error: null }

  it('uses the google provider — the same identity the redirect flow links, so existing members keep their account', async () => {
    const { client, signInWithIdToken } = fakeSupabase(session)
    expect(await signInWithGoogleIdToken(client, { credential: 'jwt', rawNonce: 'n', captchaToken: 'cap' })).toEqual({ ok: true })
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'jwt', nonce: 'n', options: { captchaToken: 'cap' } })
  })

  it('sends no captcha option when there is no token', async () => {
    const { client, signInWithIdToken } = fakeSupabase(session)
    await signInWithGoogleIdToken(client, { credential: 'jwt', rawNonce: 'n', captchaToken: null })
    expect(signInWithIdToken).toHaveBeenCalledWith({ provider: 'google', token: 'jwt', nonce: 'n' })
  })

  it('refuses without a credential or nonce, never calling Supabase', async () => {
    const { client, signInWithIdToken } = fakeSupabase(session)
    expect(await signInWithGoogleIdToken(client, { credential: '', rawNonce: 'n', captchaToken: null })).toEqual({ ok: false, message: GOOGLE_SIGN_IN_FAILED })
    expect(await signInWithGoogleIdToken(client, { credential: 'jwt', rawNonce: '', captchaToken: null })).toEqual({ ok: false, message: GOOGLE_SIGN_IN_FAILED })
    expect(signInWithIdToken).not.toHaveBeenCalled()
  })

  it('maps errors to member copy — banned, bad nonce, network — never echoing the provider message or token', async () => {
    for (const result of [
      { data: { session: null, user: null }, error: { code: 'user_banned', message: 'User is banned' } },
      { data: { session: null, user: null }, error: { code: 'bad_jwt', message: 'Passed nonce and nonce in id_token should either both exist or not.' } },
      { data: { session: null, user: { id: 'u' } }, error: null },
    ]) {
      const { client } = fakeSupabase(result)
      const out = await signInWithGoogleIdToken(client, { credential: 'secret-jwt', rawNonce: 'n', captchaToken: null })
      expect(out).toEqual({ ok: false, message: GOOGLE_SIGN_IN_FAILED })
    }
    const throwing = { auth: { signInWithIdToken: async () => { throw new Error('network secret-jwt') } } } as never
    expect(await signInWithGoogleIdToken(throwing, { credential: 'secret-jwt', rawNonce: 'n', captchaToken: null })).toEqual({ ok: false, message: GOOGLE_SIGN_IN_FAILED })
  })

  it('a CAPTCHA rejection asks the member to redo the check', async () => {
    const { client } = fakeSupabase({ data: { session: null, user: null }, error: { code: 'captcha_failed', message: 'captcha protection: request disallowed' } })
    expect(await signInWithGoogleIdToken(client, { credential: 'jwt', rawNonce: 'n', captchaToken: 'x' })).toEqual({ ok: false, message: GOOGLE_CAPTCHA_FAILED })
  })
})

describe('post-sign-in destination (googleSignInDestination)', () => {
  beforeEach(() => {
    getUser.mockReset()
    resolvePostAuthDestination.mockReset()
    resolvePostAuthDestination.mockImplementation(async (_s: unknown, _id: string, requested: string) => requested)
  })

  it('no session → back to sign-in with the generic error', async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    const { googleSignInDestination } = await import('@/app/sign-in/google-destination-action')
    expect(await googleSignInDestination('/letters/1')).toBe('/sign-in?error=auth_failed')
    expect(resolvePostAuthDestination).not.toHaveBeenCalled()
  })

  it('return-to-next survives: the same account-entry routing /auth/callback uses, for the session user only', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'session-user' } } })
    const { googleSignInDestination } = await import('@/app/sign-in/google-destination-action')
    expect(await googleSignInDestination('/letters/abc?x=1')).toBe('/letters/abc?x=1')
    expect(resolvePostAuthDestination).toHaveBeenCalledWith(expect.anything(), 'session-user', '/letters/abc?x=1')
  })

  it('new members are routed into onboarding by the shared resolver', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'new-user' } } })
    resolvePostAuthDestination.mockResolvedValue('/begin?next=%2Fhome')
    const { googleSignInDestination } = await import('@/app/sign-in/google-destination-action')
    expect(await googleSignInDestination(null)).toBe('/begin?next=%2Fhome')
    expect(resolvePostAuthDestination).toHaveBeenCalledWith(expect.anything(), 'new-user', '/home')
  })

  it('unsafe next values fall back to /home', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u' } } })
    const { googleSignInDestination } = await import('@/app/sign-in/google-destination-action')
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/.//evil.example', 42, { x: 1 }]) {
      expect(await googleSignInDestination(bad)).toBe('/home')
    }
  })
})

describe('sign-in page wiring', () => {
  const page = read('app/sign-in/page.tsx')
  const button = read('app/sign-in/google-identity-button.tsx')

  it('keeps the redirect flow as the fallback when GIS is not configured or cannot load', () => {
    expect(page).toContain('signInWithOAuth({')
    expect(page).toMatch(/useGoogleIdentity = Boolean\(googleClientId\) && !gisUnavailable/)
    expect(page).toContain('onUnavailable={() => setGisUnavailable(true)}')
  })

  it('never logs the Google credential or nonce', () => {
    for (const src of [page, button, read('lib/google-identity.ts'), read('app/sign-in/google-destination-action.ts')]) {
      expect(src).not.toMatch(/console\.[a-z]+\([^)]*(credential|nonce|token)/i)
    }
  })

  it('binds each Google attempt to a fresh hashed nonce and uses popup mode', () => {
    expect(button).toContain('nonce: nonce.hashed')
    expect(button).toContain("ux_mode: 'popup'")
    expect(button).toContain('onCredentialRef.current(response.credential, nonce.raw)')
    expect(button).toContain('void setup()')
  })

  it("gives Google's script the page nonce so its injected stylesheet satisfies the CSP", () => {
    expect(button).toMatch(/querySelector<HTMLScriptElement>\('script\[nonce\]'\)\?\.nonce/)
    expect(button).toContain('script.nonce = pageNonce')
  })

  it('does not change magic-link sign-in', () => {
    expect(page.match(/signInWithOtp\(\{/g)?.length).toBe(2)
  })
})
