'use client'

import { Suspense, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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

function SignInForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  )
  const [errorMessage, setErrorMessage] = useState(() =>
    searchParams.get('error') === 'auth_failed'
      ? 'Something went wrong signing you in. Please try again.'
      : ''
  )
  const [googleLoading, setGoogleLoading] = useState(false)
  const [joinIntent, setJoinIntent] = useState(() => searchParams.get('intent') === 'join')

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
          emailRedirectTo: `${window.location.origin}/auth/callback`,
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

  async function handleGoogleSignIn() {
    setErrorMessage('')
    setGoogleLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
    <main className="min-h-screen flex items-center justify-center p-8">
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
          <p className="text-sm">
            Check <span className="font-medium">{email}</span> for a magic
            link to sign in.
          </p>
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
