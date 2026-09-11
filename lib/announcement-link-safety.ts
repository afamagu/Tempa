/**
 * The narrow, TEMPA-specific Announcement link policy (Final
 * Correction round, item 2) — deliberately narrower than TipTap's own
 * default protocol allowlist. Only two shapes are ever safe: an
 * absolute https:// URL, or an internal relative URL beginning with
 * exactly one '/' (a protocol-relative '//host' is rejected — it
 * resolves to whatever scheme the page itself was loaded over, which
 * is not a guarantee TEMPA controls), and containing NO backslash
 * anywhere (SQL Hardening round, item 1) — browser URL parsing treats
 * a backslash as equivalent to '/', so '/\evil.example' would
 * otherwise parse as a protocol-relative '//evil.example' host
 * reference despite passing the plain "starts with one '/'" check on
 * its own.
 *
 * This is the CLIENT-side half of a three-layer enforcement: the same
 * policy is re-implemented in SQL as
 * public.announcement_href_is_safe (docs/sql/2026-09-19-question-
 * slots-and-premium-announcements.sql) as the actual database/RPC
 * boundary — that is the real security boundary, since a direct RPC
 * call can bypass the editor entirely. This module exists so the
 * editor (announcement-editor.tsx) can refuse an unsafe link before
 * even attempting to save it, and so the renderer
 * (app/announcement-body.tsx) can refuse to render one defensively,
 * even though the database should never contain one in the first
 * place.
 */
const CONTROL_OR_WHITESPACE = /[\s\x00-\x1F]/

export function isAnnouncementHrefSafe(href: string): boolean {
  if (typeof href !== 'string') return false
  if (href.length === 0 || href.length > 2048) return false
  if (CONTROL_OR_WHITESPACE.test(href)) return false
  if (href.startsWith('https://') && href.length > 'https://'.length) return true
  if (href.startsWith('/') && !href.startsWith('//') && !href.includes('\\')) return true
  return false
}
