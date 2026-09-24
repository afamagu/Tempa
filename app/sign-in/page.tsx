'use client'

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import TempaEmblem from '@/app/tempa-emblem'
import TurnstileWidget, { type TurnstileWidgetHandle } from './turnstile-widget'

/**
 * Board live-test corrections (2026-09-10): an external Dispatch's
 * "Join Tempa" CTA previously landed here framed only as "Sign in,"
 * confusing for a first-time visitor who has never had an account —
 * asking them to "sign in" to something they've never joined reads as
 * broken. The underlying auth mechanism is unchanged either way (magic
 * link creates an account for a new email and signs in an existing one
 * identically; Google OAuth behaves the same way) — this never guesses
 * whether the visitor already has an account, it only changes which
 * framing/copy greets them, driven by a plain `?intent=join` query
 * param rather than a second auth implementation. Existing links to
 * plain /sign-in (e.g. an authenticated redirect) are unaffected.
 *
 * Reads both `error` and `intent` via next/navigation's `useSearchParams`
 * rather than a `window.location.search` read at initial-state time — a
 * live-test check found the latter goes stale for a client-side `<Link>`
 * navigation into this page (Next's route prefetch can render this
 * page's initial state before the browser's own `window.location` has
 * actually updated to the new URL), silently landing on "Sign in" even
 * though the address bar correctly showed `?intent=join`.
 * `useSearchParams` tracks Next's own router state instead, so it stays
 * correct regardless of how the navigation happened. Requires a
 * Suspense boundary per Next's own rule for any `useSearchParams` call.
 */

/**
 * Pre-beta email auth bot protection (2026-09-15) — maps a Supabase Auth
 * error to a restrained, TEMPA-facing message. Deliberately never
 * forwards the SDK's own `error.message` verbatim to the client: Supabase
 * itself is careful not to reveal whether a given email already has an
 * account, but a raw provider string could still leak internal detail
 * (exact rate-limit wording, provider-specific phrasing) that a TEMPA
 * user has no use for and an attacker could use to fingerprint behavior.
 * A pure function (no component/DOM needed) so it's directly testable,
 * matching this codebase's own established pattern (e.g.
 * resolvePostBlockNavigation in block-button.tsx).
 */
export function getAuthErrorMessage(error: { message?: string; status?: number } | null | undefined): string {
  if (!error) return ''

  const message = (error.message ?? '').toLowerCase()

  if (message.includes('captcha')) {
    return "We couldn't verify you're not a robot. Please try again."
  }

  if (message.includes('rate limit') || error.status === 429) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }

  return 'Something went wrong. Please try again.'
}

/**
 * Checkpoint 1, Phase B — GoTrue's own token-verification failures
 * (e.g. an already-consumed/expired magic-link token) arrive as a URL
 * FRAGMENT (`#error=access_denied&error_code=otp_expired&...`), never
 * a query param — fragments are never sent to the server, so
 * app/auth/callback/route.ts can never see them; it only ever sees
 * that fragments existed indirectly, via the browser's own standard
 * "inherit the previous fragment when a redirect Location carries
 * none" behavior, which is why that fragment survives all the way onto
 * `/sign-in?error=auth_failed` unchanged. Read client-side only (see
 * the effect below — fragments do not exist during SSR).
 *
 * Deliberately never forwards `error_description` verbatim to the
 * client for the same reason getAuthErrorMessage never forwards a raw
 * SDK message — only a hand-picked, restrained TEMPA-facing string per
 * KNOWN error_code, with the same generic fallback as everywhere else
 * for anything unrecognized.
 */
/**
 * Cross-browser magic-link fix (2026-09-24) — extracted into its own
 * pure function for direct testability, matching getAuthErrorMessage/
 * getAuthErrorMessageFromFragment's own established pattern in this
 * file. `link_expired` is set by app/auth/confirm/verify-magic-link-
 * action.ts's own redirect when Supabase's verifyOtp itself rejects an
 * expired/already-consumed/malformed token — deliberately the SAME
 * restrained copy getAuthErrorMessageFromFragment already uses for
 * GoTrue's own `otp_expired` fragment case (a different code path
 * detecting the same underlying situation), never a raw provider error.
 */
export function getInitialErrorMessage(errorParam: string | null): string {
  if (errorParam === 'link_expired') {
    return 'This sign-in link is no longer valid. Request a new link and use the newest email.'
  }
  if (errorParam === 'auth_failed') {
    return 'Something went wrong signing you in. Please try again.'
  }
  return ''
}

export function getAuthErrorMessageFromFragment(hash: string): string {
  if (!hash) return ''

  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const errorCode = params.get('error_code')

  if (errorCode === 'otp_expired') {
    return 'This sign-in link is no longer valid. Request a new link and use the newest email.'
  }

  if (params.get('error')) {
    return 'Something went wrong signing you in. Please try again.'
  }

  return ''
}

function SignInForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  )
  const [errorMessage, setErrorMessage] = useState(() => getInitialErrorMessage(searchParams.get('error')))
  const [googleLoading, setGoogleLoading] = useState(false)
  const [joinIntent, setJoinIntent] = useState(() => searchParams.get('intent') === 'join')

  // Return-to-requested-page after sign-in (pre-beta UX polish batch 1)
  // — sanitized here too (not only server-side in the auth callback)
  // purely so an already-invalid `next` never gets forwarded onto the
  // OAuth/magic-link redirect URL at all; the callback route's own
  // sanitizeInternalPath call remains the actual security boundary,
  // since a client-supplied query param is never trusted merely
  // because this page generated the original link.
  const nextPath = sanitizeInternalPath(searchParams.get('next'))

  // Checkpoint 1, Phase B — refines the generic `?error=auth_failed`
  // message (set above, from the query string, visible during SSR)
  // with GoTrue's own more specific error_code once the fragment is
  // readable client-side, and then scrubs the fragment from the
  // visible URL so a stale auth error never lingers after later
  // interaction (e.g. a refresh, or the URL being copy-pasted
  // elsewhere). Only runs when already in the known auth_failed state
  // — never touches the URL on an ordinary page load. window.location.hash
  // doesn't exist during server rendering, so this one-time read from
  // that external source has to happen post-mount in an effect, not
  // during render — the same legitimate exception category
  // react-hooks/set-state-in-effect exists to let through (see
  // app/board/dispatch-composer.tsx's draft-restore effect for the
  // established precedent).
  useEffect(() => {
    if (searchParams.get('error') !== 'auth_failed') return
    const message = getAuthErrorMessageFromFragment(window.location.hash)
    if (!message) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read from window.location.hash, see comment above
    setErrorMessage(message)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pre-beta email auth bot protection (2026-09-15) — Turnstile is scoped
  // to this email/magic-link form only, never the Google button below
  // (Google's own account-creation friction already gates that path; see
  // the audit report). `turnstileEnabled` reflects whether a site key has
  // actually been deployed — until Afam adds NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  // this stays false and the form behaves exactly as it did before this
  // change, so local dev/test never breaks on a missing key. Once a site
  // key IS deployed, a valid token becomes required before Send magic
  // link can be pressed at all.
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const turnstileEnabled = Boolean(turnstileSiteKey)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [captchaError, setCaptchaError] = useState(false)
  const turnstileRef = useRef<TurnstileWidgetHandle>(null)

  // Magic-link "check your email" recovery (pre-beta UX polish batch 1)
  // — a member who never receives the email previously had no path
  // forward from this screen at all. `resending`/`resendError` are
  // deliberately separate from `status`/`errorMessage`: a Resend
  // attempt (success or failure) must never flip the screen away from
  // "Check your email" back to the form. cooldownEndsAt drives a plain
  // 1s-tick countdown — client-side only, purely to stop obvious
  // hammering; Supabase's own server-side rate limiting on signInWithOtp
  // remains the actual enforcement regardless of what this UI allows.
  const [resending, setResending] = useState(false)
  const [resendError, setResendError] = useState('')
  const [cooldownEndsAt, setCooldownEndsAt] = useState<number | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (cooldownEndsAt === null) return
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((cooldownEndsAt - Date.now()) / 1000))
      setResendCooldown(remaining)
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [cooldownEndsAt])

  // The one place the callback URL is built, for both the magic-link
  // form and Google — so `next` can never be appended inconsistently
  // between the two paths (Resend below reuses this too).
  function authCallbackUrl(): string {
    const url = new URL('/auth/callback', window.location.origin)
    if (nextPath) url.searchParams.set('next', nextPath)
    return url.toString()
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    // Belt-and-suspenders — the submit button is already disabled in
    // this state, but a form can still be submitted via Enter in some
    // browsers/assistive tech even while its submit button is disabled.
    if (turnstileEnabled && !captchaToken) {
      setErrorMessage('Please complete the verification check, then try again.')
      return
    }

    setStatus('sending')
    setErrorMessage('')

    const supabase = createClient()

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authCallbackUrl(),
          // Supabase's own native CAPTCHA support (docs: "Enable CAPTCHA
          // Protection") — harmless to send even before CAPTCHA is
          // switched on in the Supabase dashboard (GoTrue simply ignores
          // this field while its own captcha setting is off), and this
          // is what makes the protection genuinely server-enforced: once
          // enabled dashboard-side, a direct request to Supabase's own
          // /auth/v1/otp endpoint (bypassing this frontend entirely)
          // fails without a valid token here.
          captchaToken: captchaToken ?? undefined,
        },
      })

      if (error) {
        setStatus('error')
        setErrorMessage(getAuthErrorMessage(error))
      } else {
        setStatus('sent')
        setCooldownEndsAt(Date.now() + 60_000)
      }
    } catch {
      setStatus('error')
      setErrorMessage('Something went wrong. Please check your connection and try again.')
    } finally {
      // A Turnstile token is single-use — always reacquire a fresh one
      // after any submission attempt, success or failure, so a retry
      // (or a second send after "Check your email") never reuses a
      // stale/consumed token.
      setCaptchaToken(null)
      turnstileRef.current?.reset()
    }
  }

  async function handleResend() {
    if (resending || resendCooldown > 0) return

    if (turnstileEnabled && !captchaToken) {
      setResendError('Please complete the verification check, then try again.')
      return
    }

    setResending(true)
    setResendError('')

    const supabase = createClient()

    try {
      // The exact same signInWithOtp call as the initial send — no
      // second implementation of "send a magic link," only a second
      // trigger for it. Supabase's own cooldown/rate-limit behavior
      // applies identically regardless of which button called this.
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: authCallbackUrl(),
          captchaToken: captchaToken ?? undefined,
        },
      })

      if (error) {
        setResendError(getAuthErrorMessage(error))
      } else {
        setCooldownEndsAt(Date.now() + 60_000)
      }
    } catch {
      setResendError('Something went wrong. Please check your connection and try again.')
    } finally {
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      setResending(false)
    }
  }

  function handleUseDifferentEmail() {
    setStatus('idle')
    setEmail('')
    setErrorMessage('')
    setResendError('')
    setCooldownEndsAt(null)
    setResendCooldown(0)
    setCaptchaToken(null)
  }

  async function handleGoogleSignIn() {
    setErrorMessage('')
    setGoogleLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authCallbackUrl(),
      },
    })

    if (error) {
      setGoogleLoading(false)
      setErrorMessage('Could not start Google sign-in. Please try again.')
    }
    // On success the browser navigates away to Google, so there's no
    // further local state to set here.
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      {/* Brand asset correction (2026-09-24) — /sign-in is the app's one
          real logged-out landing surface (the root route always
          redirects here or onward; there is no separate marketing
          page). The full poster-style master lockup read as a pasted-on
          image with a visible outer canvas and a tagline too small to
          matter; this compact emblem + live text wordmark + live
          tagline reads as ONE composition with the auth card below it
          (smaller emblem, tighter gap) rather than a marketing banner.
          The heading text inside the card is unchanged. */}
      <div className="flex flex-col items-center gap-2">
        <TempaEmblem size={72} priority className="h-[60px] w-[60px] sm:h-[72px] sm:w-[72px]" />
        <div className="text-center">
          <p className="font-serif text-2xl italic text-foreground">Tempa</p>
          <p className="mt-0.5 text-[12px] text-muted">A more human way to connect</p>
        </div>
      </div>

      <div className="max-w-sm w-full space-y-5 rounded-md border border-foreground/12 p-6">
        <h1 className="font-serif text-2xl font-medium">
          {joinIntent ? 'Create your Tempa account' : 'Sign in'}
        </h1>

        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          className="w-full rounded-md bg-accent text-accent-foreground px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
        >
          {googleLoading ? 'Redirecting…' : 'Continue with Google'}
        </button>

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-foreground/10" />
          or
          <div className="h-px flex-1 bg-foreground/10" />
        </div>

        {status === 'sent' ? (
          <div className="space-y-3">
            <p className="text-sm">
              Check <span className="font-medium">{email}</span> for a magic
              link to sign in.
            </p>

            {/* A fresh Turnstile challenge for Resend — the initial
                send's own widget already unmounted along with the form
                branch below, and a token is single-use regardless. */}
            {turnstileSiteKey && (
              <TurnstileWidget
                ref={turnstileRef}
                siteKey={turnstileSiteKey}
                onVerify={(token) => {
                  setCaptchaToken(token)
                  setCaptchaError(false)
                }}
                onExpire={() => setCaptchaToken(null)}
                onError={() => {
                  setCaptchaToken(null)
                  setCaptchaError(true)
                }}
              />
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || resendCooldown > 0 || (turnstileEnabled && !captchaToken)}
                className="font-medium underline decoration-foreground/30 underline-offset-4 hover:text-foreground disabled:cursor-default disabled:text-muted disabled:no-underline"
              >
                {resending
                  ? 'Resending…'
                  : resendCooldown > 0
                    ? `Resend magic link (${resendCooldown}s)`
                    : 'Resend magic link'}
              </button>
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="text-muted underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
              >
                Use a different email
              </button>
            </div>

            {resendError && <p className="text-sm text-red-600">{resendError}</p>}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-foreground/15 bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-accent"
            />

            {turnstileSiteKey && (
              <div className="space-y-1.5">
                <TurnstileWidget
                  ref={turnstileRef}
                  siteKey={turnstileSiteKey}
                  onVerify={(token) => {
                    setCaptchaToken(token)
                    setCaptchaError(false)
                  }}
                  onExpire={() => setCaptchaToken(null)}
                  onError={() => {
                    setCaptchaToken(null)
                    setCaptchaError(true)
                  }}
                />
                {captchaError && (
                  <button
                    type="button"
                    onClick={() => {
                      setCaptchaError(false)
                      turnstileRef.current?.reset()
                    }}
                    className="text-xs text-muted underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
                  >
                    Verification check didn&apos;t load. Try again.
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'sending' || (turnstileEnabled && !captchaToken)}
              className="w-full rounded-md border border-foreground/15 px-3 py-2 text-sm font-medium transition-colors hover:border-foreground/30 hover:bg-foreground/[.03] disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        {errorMessage && (
          <p className="text-sm text-red-600">{errorMessage}</p>
        )}

        {joinIntent ? (
          <p className="text-center text-sm text-muted">
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => setJoinIntent(false)}
              className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
            >
              Sign in
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted">
            New to Tempa?{' '}
            <button
              type="button"
              onClick={() => setJoinIntent(true)}
              className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
            >
              Create an account
            </button>
          </p>
        )}
      </div>
    </main>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}
