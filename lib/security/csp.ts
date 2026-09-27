/**
 * Pre-beta security F-02 — Tempa's Content-Security-Policy.
 *
 * Nonce + 'strict-dynamic' (Next.js 16 guide): proxy.ts generates a fresh
 * nonce per request, sends the policy on the REQUEST so Next.js nonces its
 * own framework/page scripts, and on the RESPONSE so the browser applies
 * it. Scripts loaded by a nonced script (e.g. Cloudflare Turnstile, which
 * the sign-in widget injects) are trusted through 'strict-dynamic'; the
 * host allowlist after it is only a fallback for pre-CSP3 browsers.
 *
 * Shipped first as Content-Security-Policy-Report-Only (see
 * CSP_ENFORCE in proxy.ts) so real violations can be observed at
 * /api/csp-report before anything is blocked. No 'unsafe-eval' outside
 * development; no 'unsafe-inline' for scripts. Inline style *attributes*
 * (React `style={{…}}`) need style-src-attr 'unsafe-inline' — they cannot
 * carry a nonce and are not a script-execution vector.
 */

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'
export const CSP_REPORT_PATH = '/api/csp-report'

export function originOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null
  } catch {
    return null
  }
}

export function generateNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export type CspOptions = {
  nonce: string
  /** Supabase project / custom-domain origins (REST, Auth, Storage). */
  supabaseOrigins: string[]
  isDev: boolean
  /** Enforcing (not Report-Only): adds directives browsers ignore in Report-Only. */
  enforce?: boolean
}

export function buildCsp({ nonce, supabaseOrigins, isDev, enforce = false }: CspOptions): string {
  const supabase = [...new Set(supabaseOrigins.filter(Boolean))]
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", TURNSTILE_ORIGIN, ...(isDev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", `'nonce-${nonce}'`]],
    ['style-src-attr', ["'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...supabase]],
    ['media-src', ["'self'", 'blob:', ...supabase]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'", ...supabase, TURNSTILE_ORIGIN, ...(isDev ? ['ws:'] : [])]],
    ['frame-src', [TURNSTILE_ORIGIN]],
    ['worker-src', ["'self'", 'blob:']],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'self'"]],
    ['report-uri', [CSP_REPORT_PATH]],
  ]
  const policy = directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
  return enforce && !isDev ? `${policy}; upgrade-insecure-requests` : policy
}
