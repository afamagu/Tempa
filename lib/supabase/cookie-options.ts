/**
 * Pre-beta security F-03 — auth cookie hardening that @supabase/ssr supports
 * without changing how sessions work.
 *
 * @supabase/ssr merges these over its defaults (Path=/, SameSite=Lax,
 * Max-Age 400 days). We add `Secure` wherever the site is served over
 * HTTPS so the session cookie is never sent over plain HTTP. `HttpOnly`
 * is deliberately NOT set: the browser client must read the session
 * cookie to call Supabase directly; making it HttpOnly would require
 * moving every browser-side Supabase call behind the server (a separate,
 * deliberate architecture change — see docs/security/PRE-BETA-PENTEST-REPORT.md).
 * Browsers treat http://localhost as a secure context, so local
 * development keeps working.
 */
export function serverCookieOptions(): { secure: boolean } {
  return { secure: process.env.NODE_ENV === 'production' }
}

export function browserCookieOptions(): { secure: boolean } {
  return { secure: typeof window !== 'undefined' && window.location.protocol === 'https:' }
}
