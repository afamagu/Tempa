import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import SignInPage, {
  getAuthErrorKey,
  getAuthErrorKeyFromFragment,
  getInitialErrorKey,
  googleResultErrorKey,
  isRefusedAccountFragment,
  type SignInErrorKey,
} from './page'
import { GOOGLE_CAPTCHA_FAILED, GOOGLE_SIGN_IN_FAILED } from '@/lib/google-identity'

let currentSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
}))
// The language control's Server Action (cookie only) — not exercised here.
vi.mock('@/app/locale-actions', () => ({ setInterfaceLanguage: async () => ({ ok: true, locale: 'en' }) }))
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
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en}>
      <SignInPage />
    </NextIntlClientProvider>
  )
}

// Sign-in errors are stable semantic keys (localized at presentation); the
// English dictionary must keep every original restrained sentence exactly.
const englishError = (key: SignInErrorKey | null) => (key ? en.SignIn.errors[key] : '')

// Pre-beta email auth bot protection (2026-09-15) — getAuthErrorMessage
// is a pure function (no component/DOM needed), matching this codebase's
// own established pattern for testing logic extracted out of a
// click/effect-driven component (e.g. resolvePostBlockNavigation in
// block-button.tsx). It exists specifically so a raw Supabase
// error.message is never shown to the user — see its own doc comment.
describe('getAuthErrorKey — sanitized auth errors', () => {
  it('never returns the raw error.message verbatim', () => {
    const raw = 'User already registered with a different provider (internal detail xyz)'
    const result = englishError(getAuthErrorKey({ message: raw }))
    expect(result).not.toBe(raw)
    expect(result).not.toContain('internal detail xyz')
  })

  it('maps a captcha-related failure to a restrained, specific message', () => {
    expect(getAuthErrorKey({ message: 'captcha verification process failed' })).toBe('captchaFailed')
    expect(englishError('captchaFailed')).toBe("We couldn't verify you're not a robot. Please try again.")
  })

  it('maps a rate-limit message to a restrained, specific message', () => {
    expect(getAuthErrorKey({ message: 'email rate limit exceeded' })).toBe('rateLimited')
    expect(englishError('rateLimited')).toBe('Too many attempts. Please wait a few minutes and try again.')
  })

  it('maps a 429 status to the same rate-limit message even without matching text', () => {
    expect(getAuthErrorKey({ message: 'Too Many Requests', status: 429 })).toBe('rateLimited')
  })

  it('falls back to a generic restrained message for anything else, never revealing whether the email exists', () => {
    expect(getAuthErrorKey({ message: 'User already registered' })).toBe('generic')
    const result = englishError('generic')
    expect(result).toBe('Something went wrong. Please try again.')
    expect(result.toLowerCase()).not.toContain('already registered')
    expect(result.toLowerCase()).not.toContain('exist')
  })

  it('returns no key for no error at all', () => {
    expect(getAuthErrorKey(null)).toBeNull()
    expect(getAuthErrorKey(undefined)).toBeNull()
  })

  it('Google results map to restrained keys, never the provider text', () => {
    expect(googleResultErrorKey(GOOGLE_CAPTCHA_FAILED)).toBe('googleCaptchaFailed')
    expect(googleResultErrorKey(GOOGLE_SIGN_IN_FAILED)).toBe('googleSignInFailed')
    expect(googleResultErrorKey('Passed nonce and nonce in id_token should either both exist or not.')).toBe('googleSignInFailed')
    expect(englishError('googleCaptchaFailed')).toBe(GOOGLE_CAPTCHA_FAILED)
    expect(englishError('googleSignInFailed')).toBe(GOOGLE_SIGN_IN_FAILED)
  })
})

// Checkpoint 1, Phase B — GoTrue's own token-verification failures
// (an already-consumed/expired magic-link token) arrive as a URL
// FRAGMENT, never a query param. getAuthErrorMessageFromFragment is
// the pure function that turns that fragment into calm, specific,
// sanitized copy.
describe('getAuthErrorKeyFromFragment — reads GoTrue\'s fragment-only errors safely', () => {
  it('otp_expired gets the specific, calm, actionable message', () => {
    const key = getAuthErrorKeyFromFragment(
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    )
    expect(key).toBe('linkExpired')
    expect(englishError(key)).toBe('This sign-in link is no longer valid. Request a new link and use the newest email.')
  })

  it('works whether or not the leading "#" is included', () => {
    const withHash = getAuthErrorKeyFromFragment('#error_code=otp_expired&error=access_denied')
    const withoutHash = getAuthErrorKeyFromFragment('error_code=otp_expired&error=access_denied')
    expect(withHash).toBe(withoutHash)
    expect(withHash).not.toBeNull()
  })

  it('an unrecognized error_code still falls back to the same generic wording used elsewhere, never the raw error_description', () => {
    const key = getAuthErrorKeyFromFragment('#error=server_error&error_code=unexpected_failure&error_description=Some+internal+detail')
    expect(key).toBe('signInFailed')
    const result = englishError(key)
    expect(result).toBe('Something went wrong signing you in. Please try again.')
    expect(result).not.toContain('internal detail')
    expect(result).not.toContain('unexpected_failure')
  })

  it('an empty or absent fragment returns no key — never fabricates an error', () => {
    expect(getAuthErrorKeyFromFragment('')).toBeNull()
    expect(getAuthErrorKeyFromFragment('#')).toBeNull()
  })
})

// Cross-browser magic-link fix (2026-09-24) — `link_expired` is set by
// app/auth/confirm/verify-magic-link-action.ts's own redirect when
// Supabase's verifyOtp rejects an expired/already-consumed/malformed
// token — a DIFFERENT code path than GoTrue's own fragment-based
// otp_expired above, but deliberately the exact same restrained copy.
describe('getInitialErrorKey — the initial ?error= query param, read at first render', () => {
  it('link_expired gets the same specific, calm, actionable message as the fragment-based otp_expired case', () => {
    expect(getInitialErrorKey('link_expired')).toBe('linkExpired')
    expect(getInitialErrorKey('link_expired')).toBe(getAuthErrorKeyFromFragment('#error_code=otp_expired&error=x'))
  })

  it('auth_failed keeps its existing generic message, unchanged', () => {
    expect(englishError(getInitialErrorKey('auth_failed'))).toBe('Something went wrong signing you in. Please try again.')
  })

  it('an unrecognized or absent error param returns no key', () => {
    expect(getInitialErrorKey('something_else')).toBeNull()
    expect(getInitialErrorKey(null)).toBeNull()
  })
})

// Brand asset correction (2026-09-24) — the full poster-style master
// lockup was replaced with a compact emblem + live text wordmark +
// live tagline, since the full lockup read as a pasted-on marketing
// image rather than part of the interface.
describe('SignInPage — compact brand header (emblem + live wordmark + live tagline)', () => {
  it('renders the emblem asset, never the full master lockup', () => {
    const html = render()
    expect(html).toContain(`url=${encodeURIComponent('/brand/tempa-emblem.png')}`)
    expect(html).not.toContain('tempa-logo-master')
  })

  it('renders "Tempa" and the tagline as real live text, not baked into the image', () => {
    const html = render()
    expect(html).toContain('>Tempa<')
    expect(html).toContain('A more human way to connect')
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
    // Matches the JSX usage `<TurnstileWidget` (the substring alone is
    // enough to locate it — no need to also match the exact whitespace
    // that follows, which differs between LF and CRLF-terminated
    // checkouts of this file), not the unrelated
    // `useRef<TurnstileWidgetHandle>` type annotation earlier in the
    // file (which also contains the substring "<TurnstileWidget").
    const formStart = source.indexOf('<form onSubmit={handleSubmit}')
    const widgetIndex = source.indexOf('<TurnstileWidget', formStart)
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
    expect(source).toContain("{t('verificationRetry')}")
    expect(en.SignIn.verificationRetry).toBe("Verification check didn't load. Try again.")
    expect(source).toContain('turnstileRef.current?.reset()')
  })

  it('a genuine network/thrown failure is caught and shown as a restrained, distinct message', () => {
    const submitStart = source.indexOf('async function handleSubmit')
    const submitEnd = source.indexOf('async function handleGoogleSignIn')
    const body = source.slice(submitStart, submitEnd)
    expect(body).toMatch(/catch\s*\{[\s\S]*?setErrorKey\('connection'\)[\s\S]*?\}/)
    expect(en.SignIn.errors.connection).toContain('Please check your connection')
  })
})

describe('SignInPage — Google OAuth does not depend on Turnstile', () => {
  it('handleGoogleSignIn never references captchaToken, turnstileEnabled, or the Turnstile widget', () => {
    // Finds the function's own closing brace (2-space indent) via a
    // line-ending-agnostic regex (`\r?\n`) rather than a literal `\n` —
    // an LF-only literal never matches this file's actual CRLF line
    // endings, silently matching nothing (index -1) and comparing an
    // empty slice instead of failing loudly.
    const start = source.indexOf('async function handleGoogleSignIn')
    expect(start).toBeGreaterThan(-1)
    const closingBraceMatch = /\r?\n {2}\}\r?\n/.exec(source.slice(start))
    expect(closingBraceMatch).not.toBeNull()
    const end = start + closingBraceMatch!.index
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

// Checkpoint 1, Phase B — the fragment-reading effect is mount-once,
// event/DOM driven (reads window.location.hash, calls
// window.history.replaceState) — this SSR-only harness (no jsdom)
// cannot simulate it firing, matching this file's own established
// convention for every other effect-driven behavior here (e.g. the
// Turnstile ref-reset wiring above). Source-text inspection instead
// confirms the wiring itself is correct; getAuthErrorMessageFromFragment
// itself is exercised directly, above.
describe('SignInPage — auth-error fragment is read once and then scrubbed from the URL', () => {
  it('only runs when the page already loaded in the known auth_failed state', () => {
    const effectStart = source.indexOf("if (searchParams.get('error') !== 'auth_failed') return")
    expect(effectStart).toBeGreaterThan(-1)
  })

  it('reads the fragment via getAuthErrorKeyFromFragment, never window.location.hash directly elsewhere', () => {
    expect(source).toContain('getAuthErrorKeyFromFragment(window.location.hash)')
  })

  it('refines errorMessage with the fragment-derived message when one is found', () => {
    const effectStart = source.indexOf("if (searchParams.get('error') !== 'auth_failed') return")
    const effectEnd = source.indexOf('}, [])', effectStart)
    expect(effectEnd).toBeGreaterThan(effectStart)
    const body = source.slice(effectStart, effectEnd)
    expect(body).toContain('setErrorKey(message)')
  })

  it('scrubs the fragment via history.replaceState, preserving the path and query but dropping the hash', () => {
    expect(source).toContain("window.history.replaceState(null, '', window.location.pathname + window.location.search)")
  })

  it('never touches the URL when no fragment error was found (no message)', () => {
    const effectStart = source.indexOf("if (searchParams.get('error') !== 'auth_failed') return")
    const effectEnd = source.indexOf('}, [])', effectStart)
    const body = source.slice(effectStart, effectEnd)
    expect(body).toMatch(/if \(!message\) return/)
    const guardIndex = body.indexOf('if (!message) return')
    const replaceStateIndex = body.indexOf('window.history.replaceState')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(replaceStateIndex).toBeGreaterThan(guardIndex)
  })
})

describe('SignInPage — deleted, permanently banned and expired are three different messages', () => {
  function renderWith(query: string) {
    currentSearchParams = new URLSearchParams(query)
    try {
      return render()
    } finally {
      currentSearchParams = new URLSearchParams()
    }
  }

  it('voluntarily deleted: the exact deleted-account message and a Create a new account button', () => {
    const html = renderWith('error=account_deleted')
    expect(html).toContain('This account was deleted and can’t be restored. If you’d like to return to Tempa, you’ll need to create a new account.')
    expect(html).toContain('>Create a new account</button>')
    expect(html).not.toMatch(/banned|no longer valid|expired/i)
  })

  it('permanently banned: the exact ban message, support contact, and NO create-account invitation anywhere', () => {
    const html = renderWith('error=account_banned')
    expect(html).toContain(
      'This account has been permanently banned from Tempa and can no longer be used to sign in. If you believe this is a mistake, contact support@jointempa.com.'
    )
    expect(html).not.toContain('Create a new account')
    expect(html).not.toContain('Create an account')
    expect(html).not.toMatch(/no longer valid|expired/i)
  })

  it('deleted during a suspension: no invitation, not called banned', () => {
    const html = renderWith('error=account_deleted_unavailable')
    expect(html).toContain('This account was deleted and can’t be restored.')
    expect(html).not.toContain('Create a new account')
    expect(html).not.toContain('Create an account')
    expect(html).not.toMatch(/banned/i)
  })

  it('unattributable refusal (e.g. Google): neutral, no invitation, not "banned", not "expired"', () => {
    const html = renderWith('error=account_unavailable')
    expect(html).toContain('This account can’t be used to sign in to Tempa.')
    expect(html).not.toContain('Create an account')
    expect(html).not.toMatch(/banned|expired|no longer valid/i)
  })

  it('an ordinary expired magic link still gets the normal link message and no refusal copy', () => {
    const html = renderWith('error=link_expired')
    expect(html).toContain('This sign-in link is no longer valid. Request a new link and use the newest email.')
    expect(html).not.toMatch(/deleted|banned|can’t be used to sign in/)
    expect(html).toContain('Create an account')
  })

  it('GoTrue fragment error_code=user_banned is recognised; otp_expired is not', () => {
    expect(isRefusedAccountFragment('#error=access_denied&error_code=user_banned&error_description=User+is+banned')).toBe(true)
    expect(isRefusedAccountFragment('#error=access_denied&error_code=otp_expired')).toBe(false)
    expect(isRefusedAccountFragment('')).toBe(false)
  })
})
