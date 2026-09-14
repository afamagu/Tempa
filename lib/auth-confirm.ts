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
 * query value is safe to render as a clickable link at all — the
 * actual security boundary (see app/auth/confirm/page.tsx, which never
 * redirects to this value automatically regardless of what this
 * function returns; it only ever renders it as a plain `<a href>` for
 * the human to click). Pure and side-effect-free so it's directly
 * testable without a Next.js request/response context.
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
