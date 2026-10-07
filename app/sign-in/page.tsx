'use client'

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { SIGNED_OUT_PARAM } from '@/lib/local-drafts'
import { signInRefusal } from '@/lib/sign-in-refusals'
import { SUPPORT_EMAIL } from '@/lib/legal'
import LanguageSwitcher from '@/app/language-switcher'
import ClearLocalDrafts from '@/app/clear-local-drafts'
import TempaEmblem from '@/app/tempa-emblem'
import TurnstileWidget, { type TurnstileWidgetHandle } from './turnstile-widget'
import GoogleIdentityButton from './google-identity-button'
import { googleSignInDestination } from './google-destination-action'
import { GOOGLE_CAPTCHA_FAILED, googleIdentityClientId, signInWithGoogleIdToken } from '@/lib/google-identity'
import type en from '@/messages/en.json'

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
 * Every sign-in error the member can see, as a stable semantic key. The
 * words live in the interface dictionaries (messages/*.json →
 * SignIn.errors), so localization never touches the decision logic below
 * and a provider's own error text can never become visible copy.
 */
export type SignInErrorKey = keyof typeof en.SignIn.errors

/**
 * Pre-beta email auth bot protection (2026-09-15) — maps a Supabase Auth
 * error to a restrained, TEMPA-facing message key. Deliberately never
 * forwards the SDK's own `error.message` verbatim to the client: Supabase
 * itself is careful not to reveal whether a given email already has an
 * account, but a raw provider string could still leak internal detail
 * (exact rate-limit wording, provider-specific phrasing) that a TEMPA
 * user has no use for and an attacker could use to fingerprint behavior.
 * A pure function (no component/DOM needed) so it's directly testable,
 * matching this codebase's own established pattern (e.g.
 * resolvePostBlockNavigation in block-button.tsx).
 */
export function getAuthErrorKey(error: { message?: string; status?: number } | null | undefined): SignInErrorKey | null {
  if (!error) return null

  const message = (error.message ?? '').toLowerCase()

  if (message.includes('captcha')) {
    return 'captchaFailed'
  }

  if (message.includes('rate limit') || error.status === 429) {
    return 'rateLimited'
  }

  return 'generic'
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
 * client for the same reason getAuthErrorKey never forwards a raw
 * SDK message — only a hand-picked, restrained TEMPA-facing string per
 * KNOWN error_code, with the same generic fallback as everywhere else
 * for anything unrecognized.
 */
/**
 * Cross-browser magic-link fix (2026-09-24) — extracted into its own
 * pure function for direct testability, matching getAuthErrorKey/
 * getAuthErrorKeyFromFragment's own established pattern in this
 * file. `link_expired` is set by app/auth/confirm/verify-magic-link-
 * action.ts's own redirect when Supabase's verifyOtp itself rejects an
 * expired/already-consumed/malformed token — deliberately the SAME
 * restrained copy getAuthErrorKeyFromFragment already uses for
 * GoTrue's own `otp_expired` fragment case (a different code path
 * detecting the same underlying situation), never a raw provider error.
 */
export function getInitialErrorKey(errorParam: string | null): SignInErrorKey | null {
  if (errorParam === 'link_expired') {
    return 'linkExpired'
  }
  if (errorParam === 'auth_failed') {
    return 'signInFailed'
  }
  return null
}

/** GoTrue's refusal of a banned identity (a Google sign-in carries no
 * identity Tempa could look up, so it maps to the neutral refusal). */
export function isRefusedAccountFragment(hash: string): boolean {
  if (!hash) return false
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('error_code') === 'user_banned'
}

export function getAuthErrorKeyFromFragment(hash: string): SignInErrorKey | null {
  if (!hash) return null

  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const errorCode = params.get('error_code')

  if (errorCode === 'otp_expired') {
    return 'linkExpired'
  }

  if (params.get('error')) {
    return 'signInFailed'
  }

  return null
}

/** lib/google-identity.ts's restrained result → its message key. */
export function googleResultErrorKey(message: string): SignInErrorKey {
  return message === GOOGLE_CAPTCHA_FAILED ? 'googleCaptchaFailed' : 'googleSignInFailed'
}

function SignInForm() {
  const t = useTranslations('SignIn')
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle'
  )
  const [errorKey, setErrorKey] = useState<SignInErrorKey | null>(() => getInitialErrorKey(searchParams.get('error')))
  const [googleLoading, setGoogleLoading] = useState(false)
  const [joinIntent, setJoinIntent] = useState(() => searchParams.get('intent') === 'join')
  // A refused account (deleted / permanently banned / unattributable),
  // chosen server-side from Tempa's own account state — never shown as
  // an expired link. See lib/sign-in-refusals.ts.
  const [refusal, setRefusal] = useState(() => signInRefusal(searchParams.get('error')))

  // Return-to-requested-page after sign-in (pre-beta UX polish batch 1)
  // — sanitized here too (not only server-side in the auth callback)
  // purely so an already-invalid `next` never gets forwarded onto the
  // OAuth/magic-link redirect URL at all; the callback route's own
  // sanitizeInternalPath call remains the actual security boundary,
  // since a client-supplied query param is never trusted merely
  // because this page generated the original link.
  const nextPath = sanitizeInternalPath(searchParams.get('next'))
  // F-15 — arriving right after an explicit sign-out: clear private drafts.
  const signedOut = searchParams.get(SIGNED_OUT_PARAM) === '1'

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
    const message = getAuthErrorKeyFromFragment(window.location.hash)
    if (!message) return
    if (isRefusedAccountFragment(window.location.hash)) {
      // A refused account, not a generic failure (see isRefusedAccountFragment).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read from window.location.hash, see comment above
      setRefusal(signInRefusal('account_unavailable'))
      setErrorKey(null)
      window.history.replaceState(null, '', window.location.pathname + '?error=account_unavailable')
      return
    }
    setErrorKey(message)
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
  const [resendError, setResendError] = useState<SignInErrorKey | null>(null)
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
      setErrorKey('verificationRequired')
      return
    }

    setStatus('sending')
    setErrorKey(null)

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
        setErrorKey(getAuthErrorKey(error))
      } else {
        setStatus('sent')
        setCooldownEndsAt(Date.now() + 60_000)
      }
    } catch {
      // Please check your connection — a distinct, restrained message.
      setStatus('error')
      setErrorKey('connection')
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
      setResendError('verificationRequired')
      return
    }

    setResending(true)
    setResendError(null)

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
        setResendError(getAuthErrorKey(error))
      } else {
        setCooldownEndsAt(Date.now() + 60_000)
      }
    } catch {
      setResendError('connection')
    } finally {
      setCaptchaToken(null)
      turnstileRef.current?.reset()
      setResending(false)
    }
  }

  function handleUseDifferentEmail() {
    setStatus('idle')
    setEmail('')
    setErrorKey(null)
    setResendError(null)
    setCooldownEndsAt(null)
    setResendCooldown(0)
    setCaptchaToken(null)
  }

  // Google Identity Services (lib/google-identity.ts) — Google returns an
  // ID token to THIS page, so the chooser names Tempa's own origin rather
  // than the Supabase project host. Enabled when the public client id is
  // configured. Once enabled there is deliberately NO fallback to the
  // Supabase-hosted redirect flow: if Google's script cannot load, the
  // member sees a short note and email sign-in stays available.
  const googleClientId = googleIdentityClientId()
  const useGoogleIdentity = Boolean(googleClientId)
  const [gisUnavailable, setGisUnavailable] = useState(false)
  // One submitted Google credential per page load (its nonce is then
  // spent); a retry reloads the page for a fresh GIS initialize + nonce.
  const googleSubmittedRef = useRef(false)
  const [googleRetryNeeded, setGoogleRetryNeeded] = useState(false)
  // Supabase verifies Turnstile on the ID-token grant too (its CAPTCHA
  // protection covers it, unlike the redirect flow). If the member chose
  // Google before the check finished, the credential waits here and the
  // sign-in completes as soon as a token arrives — the Google button is
  // never disabled by Turnstile.
  const [pendingGoogle, setPendingGoogle] = useState<{ credential: string; rawNonce: string } | null>(null)

  async function completeGoogleSignIn(credential: string, rawNonce: string, token: string | null) {
    if (googleSubmittedRef.current) return
    googleSubmittedRef.current = true
    setErrorKey(null)
    setPendingGoogle(null)
    setGoogleLoading(true)
    const result = await signInWithGoogleIdToken(createClient(), { credential, rawNonce, captchaToken: token })
    // A Turnstile token is single-use whatever the outcome.
    setCaptchaToken(null)
    turnstileRef.current?.reset()
    if (!result.ok) {
      setGoogleLoading(false)
      if (result.refused) {
        // Same neutral refusal /auth/callback gives a refused Google identity.
        setRefusal(signInRefusal('account_unavailable'))
        return
      }
      setGoogleRetryNeeded(true)
      setErrorKey(googleResultErrorKey(result.message))
      return
    }
    const destination = await googleSignInDestination(nextPath).catch(() => '/home')
    // Full navigation so every server component reads the new session.
    window.location.assign(destination)
  }

  function handleGoogleCredential(credential: string, rawNonce: string) {
    if (googleSubmittedRef.current) return
    if (turnstileEnabled && !captchaToken) {
      setPendingGoogle({ credential, rawNonce })
      setErrorKey('googleSecurityCheckPending')
      return
    }
    void completeGoogleSignIn(credential, rawNonce, captchaToken)
  }

  useEffect(() => {
    if (pendingGoogle && captchaToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- completes a sign-in the member already chose, once Turnstile delivers its token
      void completeGoogleSignIn(pendingGoogle.credential, pendingGoogle.rawNonce, captchaToken)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGoogle, captchaToken])

  async function handleGoogleSignIn() {
    setErrorKey(null)
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
      setErrorKey('googleStartFailed')
    }
    // On success the browser navigates away to Google, so there's no
    // further local state to set here.
  }

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      {signedOut && <ClearLocalDrafts />}
      {/* Tempa's interface language, choosable before signing in. Outside
          the form; changes only the tempa_locale cookie, keeps the URL. */}
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <LanguageSwitcher />
      </div>
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
          <p className="mt-0.5 text-[12px] text-muted">{t('tagline')}</p>
        </div>
      </div>

      <div className="max-w-sm w-full space-y-5 rounded-md border border-foreground/12 p-6">
        <h1 className="font-serif text-2xl font-medium">
          {joinIntent ? t('createAccountHeading') : t('signIn')}
        </h1>

        {joinIntent && (
          <p className="text-sm leading-relaxed text-muted">{t('pilotInviteNote')}</p>
        )}

        {useGoogleIdentity && googleClientId ? (
          googleLoading ? (
            <p className="py-2.5 text-center text-sm text-muted">{t('signingYouIn')}</p>
          ) : gisUnavailable ? (
            <p className="py-2.5 text-center text-sm text-muted">{t('googleUnavailable')}</p>
          ) : googleRetryNeeded ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full rounded-md border border-foreground/15 px-3 py-2.5 text-sm font-medium transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
            >
              {t('tryGoogleAgain')}
            </button>
          ) : (
            <GoogleIdentityButton
              clientId={googleClientId}
              joinIntent={joinIntent}
              onCredential={handleGoogleCredential}
              onUnavailable={() => setGisUnavailable(true)}
            />
          )
        ) : (
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full rounded-md bg-accent text-accent-foreground px-3 py-2.5 text-sm font-medium transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {googleLoading ? t('redirecting') : t('continueWithGoogle')}
          </button>
        )}

        <div className="flex items-center gap-3 text-xs text-muted">
          <div className="h-px flex-1 bg-foreground/10" />
          {t('or')}
          <div className="h-px flex-1 bg-foreground/10" />
        </div>

        {status === 'sent' ? (
          <div className="space-y-3">
            <p className="text-sm">
              {t.rich('checkEmail', {
                email,
                strong: (chunks) => <span className="font-medium">{chunks}</span>,
              })}
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
                  ? t('resending')
                  : resendCooldown > 0
                    ? t('resendCountdown', { seconds: resendCooldown })
                    : t('resend')}
              </button>
              <button
                type="button"
                onClick={handleUseDifferentEmail}
                className="text-muted underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
              >
                {t('useDifferentEmail')}
              </button>
            </div>

            {resendError && <p className="text-sm text-red-600">{t(`errors.${resendError}`)}</p>}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('emailPlaceholder')}
              aria-label={t('emailLabel')}
              autoComplete="email"
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
                    {t('verificationRetry')}
                  </button>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'sending' || (turnstileEnabled && !captchaToken)}
              className="w-full rounded-md border border-foreground/15 px-3 py-2 text-sm font-medium transition-colors hover:border-foreground/30 hover:bg-foreground/[.03] disabled:opacity-50"
            >
              {status === 'sending' ? t('sending') : t('sendMagicLink')}
            </button>
          </form>
        )}

        {errorKey && (
          <p className="text-sm text-red-600">{t(`errors.${errorKey}`)}</p>
        )}

        {refusal && (
          <div className="space-y-3" role="status">
            <p className="text-sm text-foreground">{t(`refusals.${refusal.kind}`, { email: SUPPORT_EMAIL })}</p>
            {refusal.offerNewAccount && (
              <button
                type="button"
                onClick={() => {
                  setRefusal(null)
                  setJoinIntent(true)
                  window.history.replaceState(null, '', window.location.pathname + '?intent=join')
                }}
                className="w-full rounded-md border border-foreground/15 px-3 py-2 text-sm font-medium transition-colors hover:border-foreground/30 hover:bg-foreground/[.03]"
              >
                {t('createNewAccount')}
              </button>
            )}
          </div>
        )}

        {refusal?.hideJoinInvitations ? null : joinIntent ? (
          <p className="text-center text-sm text-muted">
            {t('alreadyHaveAccount')}{' '}
            <button
              type="button"
              onClick={() => setJoinIntent(false)}
              className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
            >
              {t('signIn')}
            </button>
          </p>
        ) : (
          <p className="text-center text-sm text-muted">
            {t('newToTempa')}{' '}
            <button
              type="button"
              onClick={() => setJoinIntent(true)}
              className="underline decoration-foreground/30 underline-offset-4 hover:text-foreground"
            >
              {t('createAnAccount')}
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
