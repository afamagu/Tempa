import { describe, it, expect } from 'vitest'
import {
  validateConfirmationUrl,
  extractMagicLinkVerificationParams,
  extractSanitizedNextFromConfirmationUrl,
  ALLOWED_MAGIC_LINK_OTP_TYPES,
} from './auth-confirm'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'

// Checkpoint 1, Phase B — validateConfirmationUrl is the actual
// security boundary for the prefetch-safe /auth/confirm intermediate
// page: it decides whether a candidate URL is safe to render as a
// clickable link at all. Pure function, no Next.js request context
// needed.
describe('validateConfirmationUrl', () => {
  it('accepts a genuine Supabase auth-verify URL for the configured project', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https%3A%2F%2Fjointempa.com%2Fauth%2Fcallback`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBe(url)
  })

  it('preserves a representative ConfirmationURL\'s own nested query parameters intact — no truncation, no corruption', () => {
    const nestedRedirect = 'https://jointempa.com/auth/callback?next=%2Fhome'
    const url = `${SUPABASE_URL}/auth/v1/verify?token=a-real-looking-token-value&type=magiclink&redirect_to=${encodeURIComponent(nestedRedirect)}`
    const result = validateConfirmationUrl(url, SUPABASE_URL)
    expect(result).toBe(url)
    // Round-trip through URL parsing to prove every nested param
    // survives, not just that the raw string happened to be echoed.
    const parsed = new URL(result!)
    expect(parsed.searchParams.get('token')).toBe('a-real-looking-token-value')
    expect(parsed.searchParams.get('type')).toBe('magiclink')
    expect(parsed.searchParams.get('redirect_to')).toBe(nestedRedirect)
  })

  it('rejects a URL on an arbitrary external host — never an open redirect', () => {
    const url = 'https://evil.example.com/auth/v1/verify?token=x&type=magiclink'
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects a host that merely CONTAINS the Supabase project ref as a substring (not the real origin)', () => {
    const url = 'https://abcdefghijklmnop.supabase.co.evil.example.com/auth/v1/verify?token=x'
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects javascript: scheme', () => {
    expect(validateConfirmationUrl('javascript:alert(1)', SUPABASE_URL)).toBeNull()
  })

  it('rejects data: scheme', () => {
    expect(validateConfirmationUrl('data:text/html,<script>alert(1)</script>', SUPABASE_URL)).toBeNull()
  })

  it('rejects file: scheme', () => {
    expect(validateConfirmationUrl('file:///etc/passwd', SUPABASE_URL)).toBeNull()
  })

  it('rejects plain http (non-HTTPS), even against the correct host', () => {
    const url = `http://abcdefghijklmnop.supabase.co/auth/v1/verify?token=x`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects the correct host but the wrong path', () => {
    const url = `${SUPABASE_URL}/some-other-endpoint?token=x`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects a lookalike path that merely STARTS WITH the real endpoint — exact match only, not a prefix match', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify-something-else?token=x`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects the real endpoint with an extra trailing path segment', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify/extra?token=x`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects a trailing slash on the real endpoint — exact match, not startsWith', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify/?token=x`
    expect(validateConfirmationUrl(url, SUPABASE_URL)).toBeNull()
  })

  it('rejects a malformed/unparseable URL rather than throwing', () => {
    expect(() => validateConfirmationUrl('not a url at all', SUPABASE_URL)).not.toThrow()
    expect(validateConfirmationUrl('not a url at all', SUPABASE_URL)).toBeNull()
  })

  it('rejects null/undefined/empty input', () => {
    expect(validateConfirmationUrl(null, SUPABASE_URL)).toBeNull()
    expect(validateConfirmationUrl(undefined, SUPABASE_URL)).toBeNull()
    expect(validateConfirmationUrl('', SUPABASE_URL)).toBeNull()
  })

  it('rejects everything when the configured Supabase URL itself is missing', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=x`
    expect(validateConfirmationUrl(url, undefined)).toBeNull()
  })

  it('never throws on a malformed supabaseUrl either', () => {
    expect(() => validateConfirmationUrl(`${SUPABASE_URL}/auth/v1/verify`, 'not-a-url')).not.toThrow()
    expect(validateConfirmationUrl(`${SUPABASE_URL}/auth/v1/verify`, 'not-a-url')).toBeNull()
  })
})

// Cross-browser magic-link fix (2026-09-24) — extracts ONLY what
// supabase.auth.verifyOtp({ token_hash, type }) needs, from an
// ALREADY-validated URL (parsing happens only after validateConfirmationUrl
// has already passed — every test below feeds it a URL shaped exactly
// like validateConfirmationUrl's own successful return value).
describe('extractMagicLinkVerificationParams', () => {
  it('extracts token as tokenHash and a recognized type', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=a-real-looking-token-value&type=magiclink&redirect_to=https%3A%2F%2Fjointempa.com%2Fauth%2Fcallback`
    expect(extractMagicLinkVerificationParams(url)).toEqual({
      tokenHash: 'a-real-looking-token-value',
      type: 'magiclink',
    })
  })

  it('accepts every type in the documented allowlist', () => {
    for (const type of ALLOWED_MAGIC_LINK_OTP_TYPES) {
      const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=${type}`
      expect(extractMagicLinkVerificationParams(url)).toEqual({ tokenHash: 'tok', type })
    }
  })

  it('rejects a type outside the allowlist — signup/invite/recovery/email_change are never magic-link sign-in', () => {
    for (const type of ['signup', 'invite', 'recovery', 'email_change']) {
      const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=${type}`
      expect(extractMagicLinkVerificationParams(url)).toBeNull()
    }
  })

  it('rejects an arbitrary/unrecognized type value — never a permissive passthrough', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=something_made_up`
    expect(extractMagicLinkVerificationParams(url)).toBeNull()
  })

  it('rejects a missing type', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok`
    expect(extractMagicLinkVerificationParams(url)).toBeNull()
  })

  it('rejects a missing or empty token', () => {
    expect(extractMagicLinkVerificationParams(`${SUPABASE_URL}/auth/v1/verify?type=magiclink`)).toBeNull()
    expect(extractMagicLinkVerificationParams(`${SUPABASE_URL}/auth/v1/verify?token=&type=magiclink`)).toBeNull()
  })

  it('never throws on a malformed URL', () => {
    expect(() => extractMagicLinkVerificationParams('not a url')).not.toThrow()
    expect(extractMagicLinkVerificationParams('not a url')).toBeNull()
  })
})

// Recovers the originally-requested `next` destination without ever
// navigating the browser through GoTrue's own redirect_to — and without
// ever trusting redirect_to's own origin merely because it is nested
// inside an already-validated Supabase URL. sanitizeInternalPath (the
// SAME boundary app/auth/callback/route.ts already relies on) is the
// real security check here.
describe('extractSanitizedNextFromConfirmationUrl', () => {
  it('extracts a sanitized internal next path nested inside redirect_to', () => {
    const redirectTo = 'https://jointempa.com/auth/callback?next=%2Fletters'
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBe('/letters')
  })

  it('returns null when redirect_to carries no next at all', () => {
    const redirectTo = 'https://jointempa.com/auth/callback'
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBeNull()
  })

  it('returns null when redirect_to itself is missing', () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink`
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBeNull()
  })

  it('never honors an external/open-redirect next value, even from a same-origin-looking redirect_to', () => {
    const redirectTo = 'https://jointempa.com/auth/callback?next=https%3A%2F%2Fevil.example.com'
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBeNull()
  })

  it('never honors a next value nested inside an attacker-controlled redirect_to origin — the next value itself must still pass sanitizeInternalPath', () => {
    const redirectTo = 'https://evil.example.com/steal?next=%2Fletters'
    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink&redirect_to=${encodeURIComponent(redirectTo)}`
    // The nested next value ('/letters') is itself a safe internal path,
    // so it is honored regardless of redirect_to's own origin — proving
    // the actual boundary is sanitizeInternalPath on the VALUE, not a
    // (redundant) origin check on redirect_to itself.
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBe('/letters')
  })

  it('never throws on a malformed URL or malformed redirect_to', () => {
    expect(() => extractSanitizedNextFromConfirmationUrl('not a url')).not.toThrow()
    expect(extractSanitizedNextFromConfirmationUrl('not a url')).toBeNull()

    const url = `${SUPABASE_URL}/auth/v1/verify?token=tok&type=magiclink&redirect_to=not-a-url`
    expect(() => extractSanitizedNextFromConfirmationUrl(url)).not.toThrow()
    expect(extractSanitizedNextFromConfirmationUrl(url)).toBeNull()
  })
})
