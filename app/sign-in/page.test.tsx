import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import SignInPage, { getAuthErrorMessage } from './page'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async () => ({ error: null }),
      signInWithOAuth: async () => ({ error: null }),
    },
  }),
}))

const SOURCE_PATH = path.join(__dirname, 'page.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

function render() {
  return renderToStaticMarkup(<SignInPage />)
}

// Pre-beta email auth bot protection (2026-09-15) — getAuthErrorMessage
// is a pure function (no component/DOM needed), matching this codebase's
// own established pattern for testing logic extracted out of a
// click/effect-driven component (e.g. resolvePostBlockNavigation in
// block-button.tsx). It exists specifically so a raw Supabase
// error.message is never shown to the user — see its own doc comment.
describe('getAuthErrorMessage — sanitized auth errors', () => {
  it('never returns the raw error.message verbatim', () => {
    const raw = 'User already registered with a different provider (internal detail xyz)'
    const result = getAuthErrorMessage({ message: raw })
    expect(result).not.toBe(raw)
    expect(result).not.toContain('internal detail xyz')
  })

  it('maps a captcha-related failure to a restrained, specific message', () => {
    const result = getAuthErrorMessage({ message: 'captcha verification process failed' })
    expect(result).toBe("We couldn't verify you're not a robot. Please try again.")
  })

  it('maps a rate-limit message to a restrained, specific message', () => {
    const result = getAuthErrorMessage({ message: 'email rate limit exceeded' })
    expect(result).toBe('Too many attempts. Please wait a few minutes and try again.')
  })

  it('maps a 429 status to the same rate-limit message even without matching text', () => {
    const result = getAuthErrorMessage({ message: 'Too Many Requests', status: 429 })
    expect(result).toBe('Too many attempts. Please wait a few minutes and try again.')
  })

  it('falls back to a generic restrained message for anything else, never revealing whether the email exists', () => {
    const result = getAuthErrorMessage({ message: 'User already registered' })
    expect(result).toBe('Something went wrong. Please try again.')
    expect(result.toLowerCase()).not.toContain('already registered')
    expect(result.toLowerCase()).not.toContain('exist')
  })

  it('returns an empty string for no error at all', () => {
    expect(getAuthErrorMessage(null)).toBe('')
    expect(getAuthErrorMessage(undefined)).toBe('')
  })
})

describe('SignInPage — existing intent=join / sign-in UI behavior remains intact', () => {
  it('renders the default "Sign in" framing and both auth affordances', () => {
    const html = render()
    expect(html).toContain('Sign in')
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Send magic link')
    expect(html).toContain('Create an account')
  })

  it('still renders the email input and Google button exactly as before', () => {
    const html = render()
    expect(html).toContain('type="email"')
    expect(html).toContain('you@example.com')
  })
})

describe('SignInPage — Turnstile is passed as captchaToken to signInWithOtp', () => {
  it('signInWithOtp is called with options.captchaToken sourced from captchaToken state', () => {
    const submitStart = source.indexOf('async function handleSubmit')
    const submitEnd = source.indexOf('async function handleGoogleSignIn')
    const body = source.slice(submitStart, submitEnd)
    expect(body).toContain('signInWithOtp({')
    expect(body).toContain('captchaToken: captchaToken ?? undefined,')
  })

  it('the widget is only rendered inside the email form, never near the Google button', () => {
    // Matches the JSX usage `<TurnstileWidget\n  ref=...>`, not the
    // unrelated `useRef<TurnstileWidgetHandle>` type annotation earlier
    // in the file (which also contains the substring "<TurnstileWidget").
    const formStart = source.indexOf('<form onSubmit={handleSubmit}')
    const widgetIndex = source.indexOf('<TurnstileWidget\n', formStart)
    const googleButtonJsxIndex = source.indexOf('onClick={handleGoogleSignIn}')
    expect(formStart).toBeGreaterThan(-1)
    expect(widgetIndex).toBeGreaterThan(formStart)
    expect(googleButtonJsxIndex).toBeGreaterThan(-1)
    expect(googleButtonJsxIndex).toBeLessThan(formStart)
  })
})

describe('SignInPage — email submission cannot proceed without a required token', () => {
  it('handleSubmit refuses to proceed when Turnstile is enabled but no token is present yet', () => {
    const submitStart = source.indexOf('async function handleSubmit')
    const submitEnd = source.indexOf('async function handleGoogleSignIn')
    const body = source.slice(submitStart, submitEnd)
    expect(body).toMatch(/if \(turnstileEnabled && !captchaToken\) \{[\s\S]*?return\s*\}/)
  })

  it('the submit button itself is disabled while Turnstile is enabled and no token has been obtained', () => {
    expect(source).toContain('disabled={status === \'sending\' || (turnstileEnabled && !captchaToken)}')
  })

  it('when no site key is configured at all, turnstileEnabled is false and the form is never blocked — local/dev/test environments without a key keep working', () => {
    expect(source).toContain('const turnstileEnabled = Boolean(turnstileSiteKey)')
  })
})

describe('SignInPage — token expiration/reset behavior', () => {
  it('a Turnstile token is single-use: captchaToken and the widget itself are both reset after every submission attempt, success or failure', () => {
    const submitStart = source.indexOf('async function handleSubmit')
    const submitEnd = source.indexOf('async function handleGoogleSignIn')
    const body = source.slice(submitStart, submitEnd)
    const finallyIndex = body.indexOf('} finally {')
    expect(finallyIndex).toBeGreaterThan(-1)
    const finallyBlock = body.slice(finallyIndex)
    expect(finallyBlock).toContain('setCaptchaToken(null)')
    expect(finallyBlock).toContain('turnstileRef.current?.reset()')
  })

  it('an expired challenge clears captchaToken via onExpire, re-disabling Send until a fresh token arrives', () => {
    expect(source).toContain('onExpire={() => setCaptchaToken(null)}')
  })
})

describe('SignInPage — CAPTCHA error/retry behavior', () => {
  it('a widget error clears captchaToken and surfaces captchaError, never leaving the token in a stale-but-truthy state', () => {
    const onErrorStart = source.indexOf('onError={() => {')
    const onErrorBody = source.slice(onErrorStart, source.indexOf('}}', onErrorStart))
    expect(onErrorBody).toContain('setCaptchaToken(null)')
    expect(onErrorBody).toContain('setCaptchaError(true)')
  })

  it('a manual retry affordance is offered on captcha error, so the user is never permanently stuck', () => {
    expect(source).toContain('captchaError && (')
    expect(source).toContain("Verification check didn&apos;t load. Try again.")
    expect(source).toContain('turnstileRef.current?.reset()')
  })

  it('a genuine network/thrown failure is caught and shown as a restrained, distinct message', () => {
    const submitStart = source.indexOf('async function handleSubmit')
    const submitEnd = source.indexOf('async function handleGoogleSignIn')
    const body = source.slice(submitStart, submitEnd)
    expect(body).toMatch(/catch\s*\{[\s\S]*?Please check your connection[\s\S]*?\}/)
  })
})

describe('SignInPage — Google OAuth does not depend on Turnstile', () => {
  it('handleGoogleSignIn never references captchaToken, turnstileEnabled, or the Turnstile widget', () => {
    const start = source.indexOf('async function handleGoogleSignIn')
    const end = source.indexOf('\n  }\n', start)
    const body = source.slice(start, end)
    expect(body).not.toContain('captchaToken')
    expect(body).not.toContain('turnstileEnabled')
    expect(body).not.toContain('Turnstile')
  })

  it('signInWithOAuth is called with no captcha-related option', () => {
    const start = source.indexOf('signInWithOAuth({')
    const end = source.indexOf('})', start)
    const body = source.slice(start, end)
    expect(body).not.toContain('captchaToken')
  })

  it('the Google button is never disabled by Turnstile state — only by its own googleLoading flag', () => {
    expect(source).toMatch(/onClick=\{handleGoogleSignIn\}\s*\n\s*disabled=\{googleLoading\}/)
  })
})
