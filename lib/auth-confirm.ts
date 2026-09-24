import { sanitizeInternalPath } from '@/lib/safe-redirect'

/**
 * Checkpoint 1, Phase B — prefetch-safe Magic Link. Supabase's own stock
 * email template links directly to a single-use `ConfirmationURL`; an
 * email security scanner/prefetcher that GETs that URL before the real
 * human clicks it silently consumes the one-time token, producing
 * GoTrue's `otp_expired` error on the human's own later click. The fix
 * Supabase itself documents is a domain-controlled intermediate page
 * (app/auth/confirm) that a scanner can safely GET with zero side
 * effects — only an explicit human click ever follows the real
 * ConfirmationURL.
 *
 * This file is the ONE place that decides whether a `confirmation_url`
 * query value is safe to work with at all — the actual security
 * boundary (see app/auth/confirm/page.tsx, which never acts on this
 * value automatically regardless of what this function returns; it only
 * ever hands the extracted, allowlisted fields below to a server action
 * that fires on an explicit human click). Pure and side-effect-free so
 * it's directly testable without a Next.js request/response context.
 *
 * Cross-browser magic-link fix (2026-09-24): the ORIGINAL design here
 * rendered a plain `<a href={validatedUrl}>` pointing directly at
 * Supabase's own `/auth/v1/verify` endpoint — clicking it took the
 * browser to GoTrue, which then 302'd to Tempa's `/auth/callback` with a
 * PKCE `?code=...`, and exchanging that code requires the `code_verifier`
 * cookie the ORIGINATING browser set when it called `signInWithOtp`.
 * Opening the email link in a different browser/device than the one that
 * requested it therefore always failed. The fix below never navigates
 * the browser to the raw ConfirmationURL at all: it extracts the
 * `token`/`type` GoTrue already embedded in that (already-validated) URL
 * and hands them to `supabase.auth.verifyOtp({ token_hash, type })`,
 * called from Tempa's OWN server, in the browser/device that is actually
 * viewing /auth/confirm — no PKCE verifier of any kind is involved.
 */

/**
 * Validates that a candidate confirmation URL is genuinely Supabase's
 * own auth-verification endpoint for THIS project — never an arbitrary
 * attacker-controlled host (an open-redirect vector otherwise), never a
 * dangerous scheme (`javascript:`, `data:`, `file:`, etc. — `new URL()`
 * already makes these structurally impossible to pass the `https:`
 * check below, since their own `protocol` never equals `"https:"`).
 *
 * Checks, in order:
 *   1. `raw` parses as an absolute URL at all.
 *   2. Its scheme is exactly `https:`.
 *   3. Its origin exactly matches the configured Supabase project's own
 *      origin (derived from NEXT_PUBLIC_SUPABASE_URL — never
 *      hardcoded, so this stays correct across environments/projects).
 *   4. Its path is EXACTLY GoTrue's own auth-verification endpoint
 *      (`/auth/v1/verify`) — an exact match, not a prefix check, so a
 *      hypothetical sibling endpoint that merely starts with the same
 *      string (e.g. `/auth/v1/verify-something-else`) can never pass.
 *      `url.pathname` never includes the query string (the URL API
 *      splits that into `.search`), so this stays compatible with the
 *      real ConfirmationURL shape
 *      (`.../auth/v1/verify?token=...&type=...&redirect_to=...`)
 *      Supabase's mailer generates — every existing test against a
 *      representative ConfirmationURL still passes unchanged.
 *
 * Returns the exact validated URL string (unmodified — no
 * re-encoding, no truncation of its own query string) on success, or
 * `null` if any check fails. Never throws.
 */
export function validateConfirmationUrl(
  raw: string | null | undefined,
  supabaseUrl: string | undefined
): string | null {
  if (!raw || !supabaseUrl) return null

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null

  let expectedOrigin: URL
  try {
    expectedOrigin = new URL(supabaseUrl)
  } catch {
    return null
  }

  if (url.origin !== expectedOrigin.origin) return null

  if (url.pathname !== '/auth/v1/verify') return null

  return url.toString()
}

/**
 * Tempa never sends a signup/invite/recovery/email_change email — the
 * ONLY email-auth action this app performs is a magic-link sign-in via
 * `supabase.auth.signInWithOtp({ email, options })` (see app/sign-in/
 * page.tsx). Supabase's own EmailOtpType (node_modules/@supabase/auth-js/
 * dist/main/lib/types.d.ts) is much broader ('signup' | 'invite' |
 * 'magiclink' | 'recovery' | 'email_change' | 'email' | (string & {})) —
 * inspected directly, not guessed. 'magiclink' is the literal GoTrue's
 * mailer uses for a link-shaped signInWithOtp confirmation; 'email' is
 * kept in the allowlist too since it is the other EmailOtpType literal
 * documented for an email-OTP sign-in (never verified against a live
 * ConfirmationURL here, since doing so would require a real production
 * credential this checkpoint must never request). Anything else —
 * 'signup'/'invite'/'recovery'/'email_change', or any unrecognized
 * value — is rejected outright: this is a "smallest explicit allowlist"
 * boundary, never a permissive passthrough of whatever `type` a
 * same-origin, same-path URL happens to carry.
 */
export const ALLOWED_MAGIC_LINK_OTP_TYPES = ['magiclink', 'email'] as const
export type MagicLinkOtpType = (typeof ALLOWED_MAGIC_LINK_OTP_TYPES)[number]

export type MagicLinkVerificationParams = {
  tokenHash: string
  type: MagicLinkOtpType
}

/**
 * Extracts ONLY the two fields `supabase.auth.verifyOtp({ token_hash,
 * type })` actually needs, from an ALREADY-validated URL (this function
 * never itself checks origin/scheme/path — call validateConfirmationUrl
 * first; parsing here happens only after that boundary has passed, per
 * this checkpoint's own explicit requirement). Returns null — never
 * throws, never falls back to a permissive default — for a missing
 * token, a missing type, or a type outside the allowlist above.
 */
export function extractMagicLinkVerificationParams(validatedUrl: string): MagicLinkVerificationParams | null {
  let url: URL
  try {
    url = new URL(validatedUrl)
  } catch {
    return null
  }

  const tokenHash = url.searchParams.get('token')
  const type = url.searchParams.get('type')

  if (!tokenHash) return null
  if (!type || !(ALLOWED_MAGIC_LINK_OTP_TYPES as readonly string[]).includes(type)) return null

  return { tokenHash, type: type as MagicLinkOtpType }
}

/**
 * Recovers the originally-requested post-sign-in destination, from an
 * ALREADY-validated URL — same "parse only after validation" rule as
 * extractMagicLinkVerificationParams above. `redirect_to` is exactly the
 * `emailRedirectTo` value app/sign-in/page.tsx's own authCallbackUrl()
 * sent to signInWithOtp (`${origin}/auth/callback?next=<sanitized>`),
 * which GoTrue echoes back verbatim inside the ConfirmationURL — read
 * here directly, without ever navigating the browser through GoTrue's
 * own redirect to get it.
 *
 * `redirect_to`'s own origin is NOT trusted merely because it is nested
 * inside an already-validated, same-origin/same-path Supabase URL — an
 * attacker who obtained a real, currently-valid token could still craft
 * a same-origin/same-path ConfirmationURL with an arbitrary `redirect_to`
 * value. The actual security boundary is the SAME one app/auth/callback/
 * route.ts already relies on for a client-supplied `next`:
 * sanitizeInternalPath, applied here to whatever `next` value is nested
 * inside `redirect_to`'s own query string, regardless of what origin
 * `redirect_to` itself carries. A missing/malformed/external/open-
 * redirect `next` value simply returns null (the caller then falls back
 * to a safe default) — this function never throws and never redirects
 * anywhere itself.
 */
export function extractSanitizedNextFromConfirmationUrl(validatedUrl: string): string | null {
  let url: URL
  try {
    url = new URL(validatedUrl)
  } catch {
    return null
  }

  const redirectTo = url.searchParams.get('redirect_to')
  if (!redirectTo) return null

  let redirectUrl: URL
  try {
    redirectUrl = new URL(redirectTo)
  } catch {
    return null
  }

  return sanitizeInternalPath(redirectUrl.searchParams.get('next'))
}
