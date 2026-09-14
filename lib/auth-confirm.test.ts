import { describe, it, expect } from 'vitest'
import { validateConfirmationUrl } from './auth-confirm'

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
