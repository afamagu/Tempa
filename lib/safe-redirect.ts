/**
 * Post-sign-in "return to requested page" (pre-beta UX polish batch 1)
 * — validates a `next` destination is a genuinely internal TEMPA path
 * before ever redirecting to it. Used both client-side (sign-in page,
 * to decide whether to forward `next` onto the OAuth/magic-link
 * redirect URL) and server-side (the auth callback route, the actual
 * authority — a client-supplied query param is never trusted merely
 * because this app generated the original link, since anyone can craft
 * their own callback URL with an arbitrary `next`).
 *
 * WHATWG URL parsing (not a regex/startsWith check) is what actually
 * catches the backslash bypass: `new URL('/\\evil.com', base)` resolves
 * to origin `https://evil.com` for a special scheme, exactly like a
 * real browser would treat it — a bare `path.startsWith('/')` check
 * alone does not see this. A protocol-relative `//evil.com` is caught
 * the same way (its own origin resolves away from the fixed base).
 */

const SAFE_BASE = 'https://tempa-internal.invalid'

export function sanitizeInternalPath(path: string | null | undefined): string | null {
  if (typeof path !== 'string' || path.length === 0 || path.length > 2048) return null
  if (!path.startsWith('/')) return null

  let parsed: URL
  try {
    parsed = new URL(path, SAFE_BASE)
  } catch {
    return null
  }

  if (parsed.origin !== SAFE_BASE) return null

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
