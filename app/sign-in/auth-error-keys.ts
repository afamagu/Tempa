import type en from '@/messages/en.json'
import { GOOGLE_CAPTCHA_FAILED } from '@/lib/google-identity'

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
